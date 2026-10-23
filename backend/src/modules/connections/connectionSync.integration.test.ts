import crypto from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../../config/database";
import { env } from "../../config/env";
import type { ScrapeResult, ScrapedTransaction, SyncOutcomeItem } from "../../types/connections.types";
import { importRows } from "../imports/importRows.service";
import { importSessions } from "../imports/importSession.service";
import { bankService } from "../bank/bank.service";
import { connectionsService } from "./connections.service";
import { sealCredentials } from "./credentialsCipher";
import { bankWorkbook, cardWorkbook } from "./scrapeWorkbook";
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

/** Emits the library's progress events, then returns `result` once `gate` opens — or CANCELLED if cancelled first. */
function fakeFactory(result: ScrapeResult, gate: Promise<void> = Promise.resolve()) {
  const calls: ScraperOptions[] = [];
  const credentialsSeen: Array<Record<string, string>> = [];
  const factory: ScraperFactory = async (options) => {
    calls.push(options);
    let listener: (type: string) => void = () => {};
    let cancel!: () => void;
    const cancelled = new Promise<"cancelled">((resolve) => { cancel = () => resolve("cancelled"); });
    return {
      onProgress(next) { listener = next; },
      cancel() { cancel(); },
      async scrape(credentials) {
        credentialsSeen.push(credentials);
        listener("LOGGING_IN");
        if (await Promise.race([gate, cancelled]) === "cancelled") return { success: false, errorType: "CANCELLED" };
        listener(result.success ? "LOGIN_SUCCESS" : "LOGIN_FAILED");
        return result;
      },
    };
  };
  return { factory, calls, credentialsSeen };
}

/** A connection made before 2026-10-20 with stored credentials — the API no longer creates these, but they still sync. */
async function legacyConnection(provider: "beinleumi" | "visaCal", credentials: Record<string, string>) {
  const kind = provider === "beinleumi" ? "bank" : "card";
  const row = await prisma.financialConnection.create({ data: {
    userId, provider, kind, label: provider, loginMethod: "password", bankAccountId: kind === "bank" ? accountId : null, credentials: sealCredentials(userId, credentials),
  } });
  return connectionsService.get(userId, row.id);
}
const bankConnection = () => legacyConnection("beinleumi", { username: "user-x", password: "secret-pass-123" });
const calConnection = () => legacyConnection("visaCal", { username: "cal-user", password: "cal-secret-456" });
const at = (day: string) => `${new Date(new Date(`${day}T00:00:00Z`).getTime() - 3 * 3600_000).toISOString()}`;
const sessionOf = async (connectionId: number, index = 0) => {
  const outcome = (await latestSync(connectionId)).outcome as Array<{ importSessionId: string | null; rows: number; note?: string }>;
  return outcome[index];
};
/** A row an earlier sync stored — its import file carries the sync prefix. */
async function syncedRow(date: string, description: string) {
  const statementImportId = (await prisma.bankStatementImport.create({ data: { userId, bankAccountId: accountId, fileName: "סנכרון הבנק הבינלאומי", fileHash: crypto.randomUUID(), coverageFrom: new Date(date), coverageTo: new Date(date) } })).id;
  await prisma.bankTransaction.create({ data: { userId, bankAccountId: accountId, transactionDate: new Date(date), description, amount: 5, type: "withdrawal", statementImportId } });
}
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
  it("keeps a legacy connection's credentials sealed and never returns them", async () => {
    const created = await bankConnection();
    const stored = await prisma.financialConnection.findFirstOrThrow({ where: { id: created.id } });
    expect(stored.credentials).not.toContain("secret-pass-123");
    expect(stored.credentials).not.toContain("user-x");
    const listed = JSON.stringify(await connectionsService.list(userId));
    expect(listed).not.toContain("secret-pass-123");
    expect(listed).not.toContain(stored.credentials);
    expect(created.verifiedAt).toBeNull();
  });

  it("creates only official-window connections: no card provider yet, no bank without an account, and nothing stored", async () => {
    for (const provider of ["visaCal", "max", "isracard"]) await expect(connectionsService.create(userId, { provider })).rejects.toThrow(/עוד לא נתמכת/);
    await expect(connectionsService.create(userId, { provider: "beinleumi" })).rejects.toThrow(/חשבון בנק/);
    const created = await connectionsService.create(userId, { provider: "beinleumi", bankAccountId: accountId });
    expect(created.loginMethod).toBe("official_window");
    expect((await prisma.financialConnection.findUniqueOrThrow({ where: { id: created.id } })).credentials).toBeNull();
  });

  it("links a bank connection only to her own account — one created a moment ago inside the dialog included", async () => {
    const otherId = (await prisma.user.create({ data: { name: "__connections_test", email: `${crypto.randomUUID()}@example.test` } })).id;
    try {
      const foreign = await bankService.createAccount(otherId, { bankName: "הבינלאומי", accountName: "עו״ש", initialBalance: 0 });
      await expect(connectionsService.create(userId, { provider: "beinleumi", bankAccountId: foreign.id })).rejects.toThrow(/חשבון בנק/);
    } finally {
      await prisma.user.delete({ where: { id: otherId } });
    }
    const fresh = await bankService.createAccount(userId, { bankName: "הבינלאומי", accountName: "חשבון משותף", initialBalance: 0 });
    const created = await connectionsService.create(userId, { provider: "beinleumi", bankAccountId: fresh.id });
    expect(created.bankAccountId).toBe(fresh.id);
    const { done } = await connectionSync.start(userId, created.id, fakeFactory({ success: true, accounts: [{ accountNumber: "1", txns: [txn("משכורת", 7000)] }] }).factory);
    await done;
    const [item] = (await latestSync(created.id)).outcome as unknown as SyncOutcomeItem[];
    const session = await prisma.importSession.findFirstOrThrow({ where: { id: item.importSessionId!, userId } });
    expect(session.answers).toMatchObject({ accountId: fresh.id });
  });

  it("says it waits for the bank's answer — not that an approval was asked — then lands the statement in the import approval", async () => {
    const connection = await bankConnection();
    let approve!: () => void;
    const gate = new Promise<void>((resolve) => { approve = resolve; });
    const { factory, calls } = fakeFactory({ success: true, accounts: [{ accountNumber: "12-345-678901", txns: [
      txn("משכורת", 7000), txn("הוראת קבע ביטוח", -129), txn("בהמתנה", -50, { status: "pending" }),
    ] }] }, gate);

    const { done } = await connectionSync.start(userId, connection.id, factory);
    await expect.poll(async () => (await latestSync(connection.id)).phase).toBe("awaiting_bank");
    expect(await latestSync(connection.id)).toMatchObject({ status: "running", method: "password", ownerPid: process.pid });
    expect((await latestSync(connection.id)).deadlineAt).not.toBeNull();
    expect(calls[0]).toMatchObject({ loginMethod: "password" });
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

  it("marks a sync cut off by a server restart as failed, but leaves one a live server still runs", async () => {
    const orphan = await calConnection();
    const live = await bankConnection();
    await prisma.connectionSync.create({ data: { connectionId: orphan.id, userId, status: "running", phase: "awaiting_bank" } });
    await prisma.connectionSync.create({ data: { connectionId: live.id, userId, status: "running", phase: "fetching", ownerPid: process.ppid } });
    await connectionSync.failInterrupted();
    expect(await latestSync(orphan.id)).toMatchObject({ status: "failed", errorType: "INTERRUPTED" });
    expect(await latestSync(live.id)).toMatchObject({ status: "running" });
  });

  it("releases the lock of a sync a quick restart cut off, so she can start again", async () => {
    const connection = await bankConnection();
    await prisma.financialConnection.update({ where: { id: connection.id }, data: { syncLockedAt: new Date() } });
    await prisma.connectionSync.create({ data: { connectionId: connection.id, userId, status: "running", phase: "awaiting_bank", ownerPid: 999_999_999 } });
    await connectionSync.failInterrupted();
    expect((await prisma.financialConnection.findUniqueOrThrow({ where: { id: connection.id } })).syncLockedAt).toBeNull();
    await (await connectionSync.start(userId, connection.id, fakeFactory({ success: true, accounts: [{ accountNumber: "1", txns: [] }] }).factory)).done;
    expect((await latestSync(connection.id)).status).toBe("succeeded");
  });

  it("fails a sync far past every time limit even if its owner pid is alive again (reused)", async () => {
    const connection = await bankConnection();
    await prisma.connectionSync.create({ data: { connectionId: connection.id, userId, status: "running", ownerPid: process.ppid, startedAt: new Date(Date.now() - 30 * 60_000) } });
    await connectionSync.failInterrupted();
    expect(await latestSync(connection.id)).toMatchObject({ status: "failed", errorType: "INTERRUPTED" });
  });

  it("honours a cancel that arrives while the fetch is finishing: nothing is offered for import", async () => {
    const connection = await bankConnection();
    let finishFetch!: () => void;
    const fetchDone = new Promise<void>((resolve) => { finishFetch = resolve; });
    const factory: ScraperFactory = async () => {
      let listener: (type: string) => void = () => {};
      return {
        onProgress(next) { listener = next; },
        cancel() { /* the fetch is past the point of stopping */ },
        async scrape() {
          listener("LOGGING_IN");
          listener("LOGIN_SUCCESS");
          await fetchDone;
          return { success: true, accounts: [{ accountNumber: "1", txns: [txn("חדש", -30)] }] };
        },
      };
    };
    const { done } = await connectionSync.start(userId, connection.id, factory);
    await expect.poll(async () => (await latestSync(connection.id)).phase).toBe("fetching");
    await connectionSync.cancel(userId, connection.id);
    finishFetch();
    await done;
    expect(await latestSync(connection.id)).toMatchObject({ status: "cancelled" });
    expect(await prisma.importSession.count({ where: { userId } })).toBe(0);
  });

  it("cancels a login on request, imports nothing, and lets her start again at once", async () => {
    const connection = await bankConnection();
    const { factory } = fakeFactory({ success: true, accounts: [{ accountNumber: "1", txns: [txn("חדש", -30)] }] }, new Promise(() => {}));
    const { done } = await connectionSync.start(userId, connection.id, factory);
    await expect.poll(async () => (await latestSync(connection.id)).phase).toBe("awaiting_bank");
    await connectionSync.cancel(userId, connection.id);
    await done;
    const sync = await latestSync(connection.id);
    expect(sync).toMatchObject({ status: "cancelled", errorType: "CANCELLED" });
    expect(sync.cancelRequestedAt).not.toBeNull();
    expect(await prisma.importSession.count({ where: { userId } })).toBe(0);
    expect((await prisma.financialConnection.findUniqueOrThrow({ where: { id: connection.id } })).syncLockedAt).toBeNull();
    const again = fakeFactory({ success: true, accounts: [{ accountNumber: "1", txns: [] }] });
    await (await connectionSync.start(userId, connection.id, again.factory)).done;
    expect((await latestSync(connection.id)).status).toBe("succeeded");
  });

  it("never lets a run's late result overwrite a status already final", async () => {
    const connection = await bankConnection();
    let release!: () => void;
    const { factory } = fakeFactory({ success: true, accounts: [{ accountNumber: "1", txns: [txn("חדש", -30)] }] }, new Promise((resolve) => { release = resolve; }));
    const { done } = await connectionSync.start(userId, connection.id, factory);
    await expect.poll(async () => (await latestSync(connection.id)).phase).toBe("awaiting_bank");
    await prisma.connectionSync.updateMany({ where: { connectionId: connection.id }, data: { status: "failed", errorType: "INTERRUPTED" } });
    release();
    await done;
    expect(await latestSync(connection.id)).toMatchObject({ status: "failed", errorType: "INTERRUPTED" });
  });

  it("refuses a second login while another process holds the connection's lock", async () => {
    const connection = await bankConnection();
    await prisma.financialConnection.update({ where: { id: connection.id }, data: { syncLockedAt: new Date() } });
    const { factory, calls } = fakeFactory({ success: true, accounts: [] });
    await expect(connectionSync.start(userId, connection.id, factory)).rejects.toThrow(/כבר רץ/);
    expect(calls).toHaveLength(0);
  });

  it("after the bank refuses stored credentials, never tries them again; moving to the official window lifts it", async () => {
    const connection = await bankConnection();
    const refused = fakeFactory({ success: false, errorType: "INVALID_PASSWORD" });
    await (await connectionSync.start(userId, connection.id, refused.factory)).done;
    expect(await connectionsService.get(userId, connection.id)).toMatchObject({ blockedReason: "INVALID_PASSWORD", retryBlockedReason: "credentials" });
    await prisma.connectionSync.updateMany({ where: { connectionId: connection.id }, data: { finishedAt: new Date(Date.now() - 3_600_000) } });
    const retry = fakeFactory({ success: true, accounts: [] });
    await expect(connectionSync.start(userId, connection.id, retry.factory)).rejects.toThrow(/לא ננסה אותם שוב/);
    expect(retry.calls).toHaveLength(0);
    const moved = await connectionsService.update(userId, connection.id, { loginMethod: "official_window" });
    expect(moved).toMatchObject({ loginMethod: "official_window", blockedReason: null, verifiedAt: null });
    expect((await prisma.financialConnection.findUniqueOrThrow({ where: { id: connection.id } })).credentials).toBeNull();
    await (await connectionSync.start(userId, connection.id, retry.factory)).done;
    expect(retry.calls).toMatchObject([{ loginMethod: "official_window" }]);
  });

  it("holds a retry right after a failed login, and shows when it opens", async () => {
    const connection = await bankConnection();
    await (await connectionSync.start(userId, connection.id, fakeFactory({ success: false, errorType: "TIMEOUT" }).factory)).done;
    const shown = await connectionsService.get(userId, connection.id);
    expect(shown.retryBlockedReason).toBe("cooldown");
    expect(shown.retryAvailableAt).not.toBeNull();
    await expect(connectionSync.start(userId, connection.id, fakeFactory({ success: true, accounts: [] }).factory)).rejects.toMatchObject({ statusCode: 429 });
  });

  it("an official-window connection stores no credentials and asks the worker for the bank's own page", async () => {
    const connection = await connectionsService.create(userId, { provider: "beinleumi", bankAccountId: accountId, loginMethod: "official_window" });
    expect((await prisma.financialConnection.findUniqueOrThrow({ where: { id: connection.id } })).credentials).toBeNull();
    let approve!: () => void;
    const official = fakeFactory({ success: true, accounts: [{ accountNumber: "1", txns: [txn("חדש", -30)] }] }, new Promise((resolve) => { approve = resolve; }));
    const { done } = await connectionSync.start(userId, connection.id, official.factory);
    await expect.poll(async () => (await latestSync(connection.id)).phase).toBe("awaiting_user");
    expect(official.calls[0]).toMatchObject({ loginMethod: "official_window" });
    expect(official.credentialsSeen[0]).toEqual({});
    approve();
    await done;
    expect(await latestSync(connection.id)).toMatchObject({ status: "succeeded", method: "official_window" });
  });

  it("says exactly where an official-window sync stopped — and only Chrome failing to start skips the wait", async () => {
    // Emits `events` as the worker would, then fails with `result`.
    const stopsAt = (events: string[], result: ScrapeResult): ScraperFactory => async () => {
      let listener: (type: string) => void = () => {};
      return { onProgress(next) { listener = next; }, cancel() {}, async scrape() { events.forEach((type) => listener(type)); return result; } };
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cases: Array<[string[], ScrapeResult, RegExp, boolean]> = [
      [[], { success: false, errorType: "BROWSER_LAUNCH", errorMessage: "Failed to launch the browser process" }, /הדפדפן לא נפתח במחשב הזה, ולכן לא נוצר קשר/, false],
      [[], { success: false, errorType: "GENERIC", errorMessage: "Failed to navigate to url https://www.fibi.co.il/private/?t=tok-9f2, status code: 403" }, /החזיר שגיאה \(קוד 403\) ולא הציג את דף הכניסה/, true],
      [[], { success: false, errorType: "GENERIC", errorMessage: "net::ERR_NAME_NOT_RESOLVED" }, /דף הכניסה של הבנק הבינלאומי לא נטען/, true],
      [["LOGGING_IN"], { success: false, errorType: "TIMEOUT", errorMessage: "official login not completed in time" }, /לא הסתיימה תוך 5 דקות/, true],
      [["LOGGING_IN"], { success: false, errorType: "BROWSER_TAB_CLOSED", errorMessage: "bank tab closed" }, /הלשונית הראשונה .* נסגרה/, true],
      [["LOGGING_IN", "LOGIN_SUCCESS"], { success: false, errorType: "GENERIC", errorMessage: "waiting for selector `div#fibi_dates` failed" }, /הכניסה הצליחה, אבל קריאת התנועות .* נכשלה/, true],
    ];
    try {
      for (const [events, result, message, cooldown] of cases) {
        const connection = await connectionsService.create(userId, { provider: "beinleumi", bankAccountId: accountId, loginMethod: "official_window" });
        await (await connectionSync.start(userId, connection.id, stopsAt(events, result))).done;
        expect(await latestSync(connection.id)).toMatchObject({ status: "failed", errorType: result.errorType, message: expect.stringMatching(message) });
        expect(!!(await connectionsService.get(userId, connection.id)).retryAvailableAt).toBe(cooldown);
        await prisma.financialConnection.delete({ where: { id: connection.id } });
      }
      const logged = warn.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(logged).toContain("Failed to launch the browser process");
      expect(logged).toContain("בשלב fetching");
      expect(logged).not.toContain("tok-9f2");
      expect(logged).not.toContain("fibi.co.il");
    } finally {
      warn.mockRestore();
    }
  });

  it("never blocks an official-window connection on a 'wrong password' it did not type", async () => {
    const connection = await connectionsService.create(userId, { provider: "beinleumi", bankAccountId: accountId, loginMethod: "official_window" });
    await (await connectionSync.start(userId, connection.id, fakeFactory({ success: false, errorType: "INVALID_PASSWORD" }).factory)).done;
    expect((await prisma.financialConnection.findUniqueOrThrow({ where: { id: connection.id } })).blockedReason).toBeNull();
  });

  it("shows the import's own counts — not the overlap — beside what stayed at the bank", async () => {
    const connection = await bankConnection();
    await syncedRow("2026-09-10", "שופרסל");
    const scrape = fakeFactory({ success: true, accounts: [{ accountNumber: "1", balance: 1234.5, txns: [
      txn("שופרסל", -5), txn("חדש", -30), txn("בדרך", -9, { status: "pending" }),
    ] }] });
    await (await connectionSync.start(userId, connection.id, scrape.factory)).done;
    const [item] = (await connectionsService.get(userId, connection.id)).syncs[0].outcome as unknown as Array<SyncOutcomeItem & { review: { status: string; counts: Record<string, number> } }>;
    expect(item.review).toEqual({ status: "ready_for_review", counts: { included: 1, duplicate: 1, pending: 0 } });
    expect(item).toMatchObject({ skippedPending: 1, siteBalance: 1234.5 });
  });

  it("lists foreign-currency rows in the outcome and imports none of them", async () => {
    const connection = await bankConnection();
    const scrape = fakeFactory({ success: true, accounts: [{ accountNumber: "1", txns: [txn("חדש", -30), txn("AMAZON", -20, { chargedCurrency: "USD", originalCurrency: "USD" })] }] });
    await (await connectionSync.start(userId, connection.id, scrape.factory)).done;
    const item = await sessionOf(connection.id) as unknown as SyncOutcomeItem;
    expect(item.skippedForeign).toBe(1);
    expect(item.foreign).toEqual([expect.objectContaining({ description: "AMAZON", originalCurrency: "USD", chargedCurrency: "USD" })]);
    const names = (await prisma.importRow.findMany({ where: { sessionId: item.importSessionId! } })).map((r) => (r.normalized as { name: string }).name);
    expect(names).toEqual(["חדש"]);
  });

  it("lets her mark a reworded synced bank row as the stored one, while a file upload of the same row is untouched", async () => {
    const connection = await bankConnection();
    await prisma.bankTransaction.create({ data: { userId, bankAccountId: accountId, transactionDate: new Date("2026-09-10"), description: "העברה לחיסכון", amount: 500, type: "withdrawal" } });
    const scrape = fakeFactory({ success: true, accounts: [{ accountNumber: "1", txns: [txn("הע. לחסכון", -500, { date: at("2026-09-10") })] }] });
    await (await connectionSync.start(userId, connection.id, scrape.factory)).done;
    const sessionId = (await sessionOf(connection.id)).importSessionId!;
    const [row] = await prisma.importRow.findMany({ where: { sessionId } });
    expect(row.resolution).toBe("review");
    const [candidate] = row.candidates as Array<{ id: number; kind: "bank" }>;
    const session = await prisma.importSession.findUniqueOrThrow({ where: { id: sessionId } });
    await importRows.edit(userId, sessionId, row.rowNumber, { version: session.version, resolution: "duplicate", candidateId: candidate.id, candidateKind: "bank" });
    expect((await prisma.importRow.findUniqueOrThrow({ where: { id: row.id } })).resolution).toBe("duplicate");
    await importRows.validate(userId, sessionId, "bank", { accountId }, "sync");

    const upload = await importSessions.create(userId, "דף חשבון.xlsx", bankWorkbook([txn("הע. לחסכון", -500, { date: at("2026-09-10") }), txn("עוד", -1, { date: at("2026-09-11") })]).buffer, { kind: "bank", accountId });
    const uploaded = await prisma.importRow.findMany({ where: { sessionId: upload.id }, orderBy: { rowNumber: "asc" } });
    expect(uploaded.map((r) => r.resolution)).toEqual(["include", "include"]);
  });

  it("sends a clamped instalment (bought on the 31st) to review against the stored purchase", async () => {
    const connection = await calConnection();
    const cardId = (await prisma.creditCard.create({ data: { userId, name: "כאל", issuer: "כאל", lastFour: "5555" } })).id;
    const creditImportId = (await prisma.creditImport.create({ data: { userId, fileName: "סנכרון כאל", importYear: 2026, importMonth: 6 } })).id;
    await prisma.creditTransaction.create({ data: { userId, creditImportId, cardId, transactionDate: new Date("2026-05-31"), billingDate: new Date("2026-05-31"), chargeDate: new Date("2026-06-02"), businessName: "מקרר", amount: 1000, paymentCount: 3, installmentNumber: 2 } });
    // The library moves instalment 2 of a 31/05 purchase to 30/06; undone, that reads 30/05, not 31/05.
    const clamped = txn("מקרר", -1000, { type: "installments", installments: { number: 2, total: 3 }, date: at("2026-06-30"), processedDate: at("2026-07-02") });
    await (await connectionSync.start(userId, connection.id, fakeFactory({ success: true, accounts: [{ accountNumber: "5555", txns: [clamped] }] }).factory)).done;
    const rows = await prisma.importRow.findMany({ where: { sessionId: (await sessionOf(connection.id)).importSessionId! } });
    expect(rows.map((r) => r.resolution)).toEqual(["review"]);
  });

  it("takes a purchase from the last file's period that was charged in a later cycle", async () => {
    const connection = await calConnection();
    const cardId = (await prisma.creditCard.create({ data: { userId, name: "כאל", issuer: "כאל", lastFour: "5555" } })).id;
    const creditImportId = (await prisma.creditImport.create({ data: { userId, fileName: "cal-march.xlsx", importYear: 2026, importMonth: 3 } })).id;
    await prisma.creditTransaction.create({ data: { userId, creditImportId, cardId, transactionDate: new Date("2026-03-05"), billingDate: new Date("2026-03-05"), chargeDate: new Date("2026-03-10"), businessName: "סופר", amount: 40 } });
    const late = txn("מסעדה", -90, { date: at("2026-03-04"), processedDate: at("2026-04-10") });
    await (await connectionSync.start(userId, connection.id, fakeFactory({ success: true, accounts: [{ accountNumber: "5555", txns: [late] }] }).factory)).done;
    const rows = await prisma.importRow.findMany({ where: { sessionId: (await sessionOf(connection.id)).importSessionId! } });
    expect(rows.map((r) => [(r.normalized as { name: string }).name, r.resolution])).toEqual([["מסעדה", "include"]]);
  });

  it("lets the exact copy claim its stored row first, so a reworded row earlier in the list cannot hide a duplicate", async () => {
    const connection = await bankConnection();
    await prisma.bankTransaction.create({ data: { userId, bankAccountId: accountId, transactionDate: new Date("2026-09-10"), description: "העברה לדני", amount: 100, type: "withdrawal" } });
    const scrape = fakeFactory({ success: true, accounts: [{ accountNumber: "1", txns: [txn("הוראת קבע ועד", -100, { date: at("2026-09-10") }), txn("העברה לדני", -100, { date: at("2026-09-10") })] }] });
    await (await connectionSync.start(userId, connection.id, scrape.factory)).done;
    const rows = await prisma.importRow.findMany({ where: { sessionId: (await sessionOf(connection.id)).importSessionId! }, orderBy: { rowNumber: "asc" } });
    expect(rows.map((r) => [(r.normalized as { name: string }).name, r.resolution])).toEqual([["הוראת קבע ועד", "include"], ["העברה לדני", "duplicate"]]);
  });

  it("two card purchases with one day and amount, one stored: the stored one asks, the other is new", async () => {
    const connection = await calConnection();
    const cardId = (await prisma.creditCard.create({ data: { userId, name: "כאל", issuer: "כאל", lastFour: "5555" } })).id;
    const creditImportId = (await prisma.creditImport.create({ data: { userId, fileName: "cal.xlsx", importYear: 2026, importMonth: 9 } })).id;
    await prisma.creditTransaction.create({ data: { userId, creditImportId, cardId, transactionDate: new Date("2026-09-09"), billingDate: new Date("2026-09-09"), chargeDate: new Date("2026-10-02"), businessName: "סופר", amount: 100 } });
    const scrape = fakeFactory({ success: true, accounts: [{ accountNumber: "5555", txns: [txn("מאפייה", -100, { date: at("2026-09-09") }), txn("סופר", -100, { date: at("2026-09-09") })] }] });
    await (await connectionSync.start(userId, connection.id, scrape.factory)).done;
    const rows = await prisma.importRow.findMany({ where: { sessionId: (await sessionOf(connection.id)).importSessionId! }, orderBy: { rowNumber: "asc" } });
    expect(rows.map((r) => [(r.normalized as { name: string }).name, r.resolution])).toEqual([["מאפייה", "include"], ["סופר", "review"]]);
  });

  it("does not hold a synced card row against a manual expense of the same day and amount", async () => {
    const connection = await calConnection();
    await prisma.creditCard.create({ data: { userId, name: "כאל", issuer: "כאל", lastFour: "5555" } });
    await prisma.expense.create({ data: { userId, expenseDate: new Date("2026-09-10"), businessName: "מזומן בשוק", amount: 70 } });
    const scrape = fakeFactory({ success: true, accounts: [{ accountNumber: "5555", txns: [txn("קפה", -70)] }] });
    await (await connectionSync.start(userId, connection.id, scrape.factory)).done;
    const rows = await prisma.importRow.findMany({ where: { sessionId: (await sessionOf(connection.id)).importSessionId! } });
    expect(rows.map((r) => r.resolution)).toEqual(["include"]);
  });

  it("leaves a card file upload on exact matching only", async () => {
    const cardId = (await prisma.creditCard.create({ data: { userId, name: "כאל", issuer: "כאל", lastFour: "5555" } })).id;
    const creditImportId = (await prisma.creditImport.create({ data: { userId, fileName: "cal.xlsx", importYear: 2026, importMonth: 9 } })).id;
    await prisma.creditTransaction.create({ data: { userId, creditImportId, cardId, transactionDate: new Date("2026-09-10"), billingDate: new Date("2026-09-10"), chargeDate: new Date("2026-10-02"), businessName: "שופרסל דיל", amount: 55 } });
    const upload = await importSessions.create(userId, "כאל.xlsx", cardWorkbook([txn("שופרסל", -55)]).buffer, { kind: "credit", cardId });
    const rows = await prisma.importRow.findMany({ where: { sessionId: upload.id } });
    expect(rows.map((r) => r.resolution)).toEqual(["include"]);
  });

  it("after approval, puts our balance next to the bank site's balance from the sync", async () => {
    const connection = await bankConnection();
    const scrape = fakeFactory({ success: true, accounts: [{ accountNumber: "1", balance: 970, txns: [txn("חדש", -30)] }] });
    await (await connectionSync.start(userId, connection.id, scrape.factory)).done;
    const before = (await connectionsService.get(userId, connection.id)).syncs[0].outcome as unknown as Array<{ ourBalance: number | null }>;
    expect(before[0].ourBalance).toBeNull();
    await prisma.importSession.update({ where: { id: (await sessionOf(connection.id)).importSessionId! }, data: { status: "completed" } });
    const after = (await connectionsService.get(userId, connection.id)).syncs[0].outcome as unknown as Array<{ siteBalance: number; ourBalance: number | null }>;
    expect(after[0].siteBalance).toBe(970);
    expect(typeof after[0].ourBalance).toBe("number");
  });

  it("offers the official window for Beinleumi only", async () => {
    await expect(connectionsService.create(userId, { provider: "visaCal", loginMethod: "official_window" })).rejects.toThrow(/עוד לא נתמכת/);
  });

  it("takes only what the account has not stored, and fetches a rejected import again", async () => {
    const connection = await bankConnection();
    // A statement imported by hand runs through 05/09; the website names its rows differently.
    // Its last day is reopened (the file may have closed before the day did): the reworded copy goes to review.
    await prisma.bankTransaction.create({ data: { userId, bankAccountId: accountId, transactionDate: new Date("2026-09-05"), description: "תיאור מהאקסל", amount: 80, type: "withdrawal" } });
    const scrape = fakeFactory({ success: true, accounts: [{ accountNumber: "1", txns: [
      txn("תיאור מהאתר", -80, { date: at("2026-09-05") }), txn("ישן", -10, { date: at("2026-09-03") }), txn("חדש", -30, { date: at("2026-09-10") }),
    ] }] });
    await (await connectionSync.start(userId, connection.id, scrape.factory)).done;
    expect(scrape.calls[0].startDate.toISOString().slice(0, 10)).toBe("2026-09-04");
    const first = await sessionOf(connection.id);
    expect(first.rows).toBe(2);
    const resolutions = await prisma.importRow.findMany({ where: { sessionId: first.importSessionId! }, orderBy: { rowNumber: "asc" }, select: { resolution: true } });
    expect(resolutions.map((r) => r.resolution)).toEqual(["review", "include"]);

    await prisma.importSession.update({ where: { id: first.importSessionId! }, data: { status: "cancelled" } });
    await (await connectionSync.start(userId, connection.id, scrape.factory)).done;
    const again = await sessionOf(connection.id);
    expect(again.rows).toBe(2);
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

  it("looks back a few days past its own synced rows for one that posted late", async () => {
    const connection = await bankConnection();
    await syncedRow("2026-09-20", "מהסנכרון");
    const scrape = fakeFactory({ success: true, accounts: [{ accountNumber: "1", txns: [
      txn("מהסנכרון", -5, { date: at("2026-09-20") }), txn("הגיע באיחור", -60, { date: at("2026-09-18") }), txn("ישן מדי", -7, { date: at("2026-09-16") }),
    ] }] });
    await (await connectionSync.start(userId, connection.id, scrape.factory)).done;
    const item = await sessionOf(connection.id);
    const rows = await prisma.importRow.findMany({ where: { sessionId: item.importSessionId! }, orderBy: { rowNumber: "asc" } });
    // The re-fetched synced row is the same bank transaction — duplicate review settles it.
    expect(rows.map((r) => [(r.normalized as { name: string }).name, r.resolution])).toEqual([["מהסנכרון", "duplicate"], ["הגיע באיחור", "include"]]);
  });

  it("brings a row that was pending last time once it settles, even with another amount and older than the stored rows", async () => {
    const connection = await bankConnection();
    await syncedRow("2026-09-20", "קיים");
    const pending = fakeFactory({ success: true, accounts: [{ accountNumber: "1", txns: [txn("תדלוק", -300, { status: "pending", date: at("2026-09-02") })] }] });
    await (await connectionSync.start(userId, connection.id, pending.factory)).done;
    expect(await sessionOf(connection.id)).toMatchObject({ rows: 0, importSessionId: null });

    const settled = fakeFactory({ success: true, accounts: [{ accountNumber: "1", txns: [txn("תדלוק פז", -212.4, { date: at("2026-09-02") })] }] });
    await (await connectionSync.start(userId, connection.id, settled.factory)).done;
    expect(settled.calls[0].startDate.toISOString().slice(0, 10)).toBe("2026-09-01");
    expect((await sessionOf(connection.id)).rows).toBe(1);
  });

  it("does not call an already approved import 'waiting' when the same rows come back", async () => {
    const connection = await bankConnection();
    const scrape = fakeFactory({ success: true, accounts: [{ accountNumber: "1", txns: [txn("חדש", -30)] }] });
    await (await connectionSync.start(userId, connection.id, scrape.factory)).done;
    await prisma.importSession.update({ where: { id: (await sessionOf(connection.id)).importSessionId! }, data: { status: "completed" } });
    await (await connectionSync.start(userId, connection.id, scrape.factory)).done;
    expect(await sessionOf(connection.id)).toMatchObject({ importSessionId: null, note: "התנועות האלה כבר נקלטו" });
    expect((await latestSync(connection.id)).message).toBe("לא נמצאו תנועות חדשות לאישור");
  });

  it("never reopens a period a file already covered, even for a pending row", async () => {
    const connection = await bankConnection();
    const pending = fakeFactory({ success: true, accounts: [{ accountNumber: "1", txns: [txn("תדלוק", -300, { status: "pending", date: at("2026-09-02") })] }] });
    await (await connectionSync.start(userId, connection.id, pending.factory)).done;
    // Meanwhile a statement through 10/09 was uploaded; it already holds the settled row in its own words.
    await prisma.bankTransaction.create({ data: { userId, bankAccountId: accountId, transactionDate: new Date("2026-09-10"), description: "פז תחנת דלק", amount: 212.4, type: "withdrawal" } });
    const settled = fakeFactory({ success: true, accounts: [{ accountNumber: "1", txns: [txn("תדלוק פז", -212.4, { date: at("2026-09-02") })] }] });
    await (await connectionSync.start(userId, connection.id, settled.factory)).done;
    expect(await sessionOf(connection.id)).toMatchObject({ rows: 0, importSessionId: null });
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
