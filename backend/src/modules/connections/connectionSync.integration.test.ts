import crypto from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../config/database";
import { env } from "../../config/env";
import type { ScrapeResult, ScrapedTransaction } from "../../types/connections.types";
import { connectionsService } from "./connections.service";
import { connectionSync } from "./connectionSync.service";
import type { ScraperFactory, ScraperOptions } from "./scraperAdapter";

let userId: number;
let accountId: number;
let storage: string;
const originalStorage = env.DOCUMENT_STORAGE_DIR;
const originalKey = env.BANK_CREDENTIALS_KEY;

const txn = (description: string, chargedAmount: number, overrides: Partial<ScrapedTransaction> = {}): ScrapedTransaction => ({
  type: "normal", date: "2026-09-09T21:00:00.000Z", processedDate: "2026-10-01T21:00:00.000Z", originalAmount: chargedAmount,
  originalCurrency: "ILS", chargedAmount, chargedCurrency: "ILS", description, status: "completed", ...overrides,
});

/** Emits the library's progress events, then returns `result` once `gate` opens. */
function fakeFactory(result: ScrapeResult, gate: Promise<void> = Promise.resolve()) {
  const calls: ScraperOptions[] = [];
  const factory: ScraperFactory = async (options) => {
    calls.push(options);
    let listener: (type: string) => void = () => {};
    return {
      onProgress(next) { listener = next; },
      async scrape() {
        listener("LOGGING_IN");
        await gate;
        listener(result.success ? "LOGIN_SUCCESS" : "LOGIN_FAILED");
        return result;
      },
    };
  };
  return { factory, calls };
}

async function bankConnection() {
  return connectionsService.create(userId, { provider: "beinleumi", bankAccountId: accountId, credentials: { username: "user-x", password: "secret-pass-123" } });
}
async function calConnection() {
  return connectionsService.create(userId, { provider: "visaCal", credentials: { username: "cal-user", password: "cal-secret-456" } });
}
const at = (day: string) => `${new Date(new Date(`${day}T00:00:00Z`).getTime() - 3 * 3600_000).toISOString()}`;
const sessionOf = async (connectionId: number, index = 0) => {
  const outcome = (await latestSync(connectionId)).outcome as Array<{ importSessionId: string | null; rows: number; note?: string }>;
  return outcome[index];
};
const latestSync = (connectionId: number) => prisma.connectionSync.findFirstOrThrow({ where: { connectionId }, orderBy: { id: "desc" } });

beforeAll(async () => {
  storage = await mkdtemp(path.join(os.tmpdir(), "mj-connections-"));
  env.DOCUMENT_STORAGE_DIR = storage;
  env.BANK_CREDENTIALS_KEY = crypto.randomBytes(32).toString("base64");
});
beforeEach(async () => {
  userId = (await prisma.user.create({ data: { name: "__connections_test", email: `${crypto.randomUUID()}@example.test` } })).id;
  accountId = (await prisma.bankAccount.create({ data: { userId, bankName: "הבינלאומי", accountName: "עו״ש" } })).id;
});
afterEach(async () => { await prisma.user.delete({ where: { id: userId } }); });
afterAll(async () => {
  env.DOCUMENT_STORAGE_DIR = originalStorage;
  env.BANK_CREDENTIALS_KEY = originalKey;
  await rm(storage, { recursive: true, force: true });
  await prisma.$disconnect();
});

describe("bank and card connections", () => {
  it("stores credentials sealed and never returns them", async () => {
    const created = await bankConnection();
    const stored = await prisma.financialConnection.findFirstOrThrow({ where: { id: created.id } });
    expect(stored.credentials).not.toContain("secret-pass-123");
    expect(stored.credentials).not.toContain("user-x");
    const listed = JSON.stringify(await connectionsService.list(userId));
    expect(listed).not.toContain("secret-pass-123");
    expect(listed).not.toContain(stored.credentials);
    expect(created.verifiedAt).toBeNull();
  });

  it("refuses a connection missing a required field, and a bank connection without an account", async () => {
    await expect(connectionsService.create(userId, { provider: "isracard", credentials: { id: "1", password: "x" } })).rejects.toThrow(/6 ספרות/);
    await expect(connectionsService.create(userId, { provider: "beinleumi", credentials: { username: "u", password: "p" } })).rejects.toThrow(/חשבון בנק/);
  });

  it("shows 'awaiting approval' while the bank login waits, then lands the statement in the import approval", async () => {
    const connection = await bankConnection();
    let approve!: () => void;
    const gate = new Promise<void>((resolve) => { approve = resolve; });
    const { factory, calls } = fakeFactory({ success: true, accounts: [{ accountNumber: "12-345-678901", txns: [
      txn("משכורת", 7000), txn("הוראת קבע ביטוח", -129), txn("בהמתנה", -50, { status: "pending" }),
    ] }] }, gate);

    const { done } = await connectionSync.start(userId, connection.id, factory);
    await expect.poll(async () => (await latestSync(connection.id)).status).toBe("awaiting_approval");
    expect(calls[0].defaultTimeout).toBeGreaterThanOrEqual(120_000);
    await expect(connectionSync.start(userId, connection.id, factory)).rejects.toThrow(/כבר רץ/);

    approve();
    await done;
    const sync = await latestSync(connection.id);
    expect(sync.status).toBe("succeeded");
    const [item] = sync.outcome as Array<{ importSessionId: string; rows: number; skippedPending: number }>;
    expect(item).toMatchObject({ rows: 2, skippedPending: 1 });
    const session = await prisma.importSession.findFirstOrThrow({ where: { id: item.importSessionId, userId } });
    expect(session).toMatchObject({ kind: "bank", status: "ready_for_review" });
    // Nothing reaches the account before the user approves the import.
    expect(await prisma.bankTransaction.count({ where: { userId } })).toBe(0);
    expect((await connectionsService.get(userId, connection.id)).verifiedAt).not.toBeNull();
  });

  it("a failing bank login does not hold back a card sync, and is never retried on its own", async () => {
    const bank = await bankConnection();
    const cal = await calConnection();
    await prisma.creditCard.create({ data: { userId, name: "כאל", issuer: "כאל", lastFour: "4321" } });
    const failing = fakeFactory({ success: false, errorType: "TIMEOUT", errorMessage: "waiting for selector" });
    const cards = fakeFactory({ success: true, accounts: [
      { accountNumber: "4321", txns: [txn("שופרסל", -230.5), txn("AMAZON", -20, { chargedCurrency: "USD" })] },
      { accountNumber: "9999", txns: [txn("פז", -150)] },
    ] });

    const [bankRun, calRun] = await Promise.all([connectionSync.start(userId, bank.id, failing.factory), connectionSync.start(userId, cal.id, cards.factory)]);
    await Promise.all([bankRun.done, calRun.done]);

    const bankSync = await latestSync(bank.id);
    expect(bankSync).toMatchObject({ status: "failed", errorType: "TIMEOUT" });
    expect(bankSync.message).toMatch(/אישור באפליקציה/);
    expect(failing.calls).toHaveLength(1);
    expect((await connectionsService.get(userId, bank.id)).verifiedAt).toBeNull();

    const calSync = await latestSync(cal.id);
    expect(calSync.status).toBe("succeeded");
    const outcome = calSync.outcome as Array<{ target: string; importSessionId: string | null; rows: number; skippedForeign: number; note?: string }>;
    expect(outcome.map((o) => [o.target, o.rows, o.skippedForeign, o.importSessionId !== null])).toEqual([["כרטיס 4321", 1, 1, true], ["כרטיס 9999", 1, 0, false]]);
    expect(outcome[1].note).toMatch(/לא מוגדר במערכת/);
    expect(await prisma.importSession.findFirstOrThrow({ where: { id: outcome[0].importSessionId!, userId } })).toMatchObject({ kind: "credit" });
  });

  it("a wrong password ends the sync with a clear message", async () => {
    const connection = await calConnection();
    const { factory } = fakeFactory({ success: false, errorType: "INVALID_PASSWORD", errorMessage: "Login failed" });
    await (await connectionSync.start(userId, connection.id, factory)).done;
    expect(await latestSync(connection.id)).toMatchObject({ status: "failed", errorType: "INVALID_PASSWORD" });
    expect((await latestSync(connection.id)).message).toMatch(/לא ננסה שוב/);
  });

  it("asks which account when one login sees several and no hint was given", async () => {
    const connection = await bankConnection();
    const { factory } = fakeFactory({ success: true, accounts: [{ accountNumber: "111-0001", txns: [] }, { accountNumber: "111-0002", txns: [] }] });
    await (await connectionSync.start(userId, connection.id, factory)).done;
    const sync = await latestSync(connection.id);
    expect(sync.status).toBe("failed");
    expect(sync.message).toMatch(/0001, 0002/);
  });

  it("marks a sync cut off by a server restart as failed", async () => {
    const connection = await calConnection();
    await prisma.connectionSync.create({ data: { connectionId: connection.id, userId, status: "awaiting_approval" } });
    await connectionSync.failInterrupted();
    expect(await latestSync(connection.id)).toMatchObject({ status: "failed" });
  });

  it("takes only what the account has not stored, and fetches a rejected import again", async () => {
    const connection = await bankConnection();
    // A statement imported by hand runs through 05/09; the website names its rows differently.
    await prisma.bankTransaction.create({ data: { userId, bankAccountId: accountId, transactionDate: new Date("2026-09-05"), description: "תיאור מהאקסל", amount: 80, type: "withdrawal" } });
    const scrape = fakeFactory({ success: true, accounts: [{ accountNumber: "1", txns: [
      txn("תיאור מהאתר", -80, { date: at("2026-09-05") }), txn("ישן", -10, { date: at("2026-09-03") }), txn("חדש", -30, { date: at("2026-09-10") }),
    ] }] });
    await (await connectionSync.start(userId, connection.id, scrape.factory)).done;
    expect(scrape.calls[0].startDate.toISOString().slice(0, 10)).toBe("2026-09-04");
    const first = await sessionOf(connection.id);
    expect(first.rows).toBe(1);

    await prisma.importSession.update({ where: { id: first.importSessionId! }, data: { status: "cancelled" } });
    await (await connectionSync.start(userId, connection.id, scrape.factory)).done;
    const again = await sessionOf(connection.id);
    expect(again.rows).toBe(1);
    expect(again.importSessionId).not.toBe(first.importSessionId);
  });

  it("replaces an import the user has not approved yet instead of offering the same rows twice", async () => {
    const connection = await bankConnection();
    const first = fakeFactory({ success: true, accounts: [{ accountNumber: "1", txns: [txn("חדש", -30)] }] });
    await (await connectionSync.start(userId, connection.id, first.factory)).done;
    const earlier = (await sessionOf(connection.id)).importSessionId!;
    const second = fakeFactory({ success: true, accounts: [{ accountNumber: "1", txns: [txn("חדש", -30), txn("עוד", -5, { date: at("2026-09-12") })] }] });
    await (await connectionSync.start(userId, connection.id, second.factory)).done;
    expect((await prisma.importSession.findUniqueOrThrow({ where: { id: earlier } })).status).toBe("cancelled");
    expect((await sessionOf(connection.id)).rows).toBe(2);
  });

  it("brings a row that was pending last time once it settles, even when it is older than the stored rows", async () => {
    const connection = await bankConnection();
    await prisma.bankTransaction.create({ data: { userId, bankAccountId: accountId, transactionDate: new Date("2026-09-20"), description: "קיים", amount: 5, type: "withdrawal" } });
    const pending = fakeFactory({ success: true, accounts: [{ accountNumber: "1", txns: [txn("חיוב חו״ל", -77, { status: "pending", date: at("2026-09-02") })] }] });
    await (await connectionSync.start(userId, connection.id, pending.factory)).done;
    expect(await sessionOf(connection.id)).toMatchObject({ rows: 0, importSessionId: null });

    const settled = fakeFactory({ success: true, accounts: [{ accountNumber: "1", txns: [txn("חיוב חו״ל", -77, { date: at("2026-09-02") })] }] });
    await (await connectionSync.start(userId, connection.id, settled.factory)).done;
    expect(settled.calls[0].startDate.toISOString().slice(0, 10)).toBe("2026-09-02");
    expect((await sessionOf(connection.id)).rows).toBe(1);
  });

  it("takes a card's rows once the card is added, and a late instalment of an old purchase by its charge date", async () => {
    const connection = await calConnection();
    const instalment = (n: number, charge: string) => txn("ספה", -500, { type: "installments", installments: { number: n, total: 6 }, date: at(["2026-07-15", "2026-08-15", "2026-09-15", "2026-10-15"][n - 1]), processedDate: at(charge) });
    const scrape = fakeFactory({ success: true, accounts: [{ accountNumber: "5555", txns: [instalment(3, "2026-10-02"), instalment(4, "2026-11-02"), txn("קפה", -12, { date: at("2026-09-26"), processedDate: at("2026-11-02") })] }] });
    await (await connectionSync.start(userId, connection.id, scrape.factory)).done;
    expect((await sessionOf(connection.id)).note).toMatch(/לא מוגדר במערכת/);

    const cardId = (await prisma.creditCard.create({ data: { userId, name: "כאל", issuer: "כאל", lastFour: "5555" } })).id;
    const creditImportId = (await prisma.creditImport.create({ data: { userId, fileName: "cal.xlsx", importYear: 2026, importMonth: 10 } })).id;
    await prisma.creditTransaction.create({ data: { userId, creditImportId, cardId, transactionDate: new Date("2026-09-25"), billingDate: new Date("2026-09-25"), chargeDate: new Date("2026-10-02"), businessName: "סופר", amount: 40 } });
    await (await connectionSync.start(userId, connection.id, scrape.factory)).done;
    const item = await sessionOf(connection.id);
    const rows = await prisma.importRow.findMany({ where: { sessionId: item.importSessionId! }, orderBy: { rowNumber: "asc" } });
    expect(rows.map((r) => (r.normalized as { name: string; date: string }).date + " " + (r.normalized as { name: string }).name)).toEqual(["2026-07-15 ספה", "2026-09-26 קפה"]);
  });
});
