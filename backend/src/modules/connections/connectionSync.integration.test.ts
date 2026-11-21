import crypto from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import app from "../../app";
import { prisma } from "../../config/database";
import { env } from "../../config/env";
import type { DepartmentFollowUp, LoanFollowUpDecision, LoanFollowUpReport, ScrapedLoan, ScrapedStandingOrder, ScrapeExtras, ScrapeResult, ScrapedTransaction, SyncOutcomeItem, SyncStage, SyncStageStatus } from "../../types/connections.types";
import type { LoanDetailsPreview, StandingOrdersPreview } from "../../types/siteSnapshot.types";
import { documentStorage } from "../documents/documentStorage.service";
import { csrfForSession, sessionCookieName } from "../gate/sessionCookie";
import { importRows } from "../imports/importRows.service";
import { importSessions, type ImportPreview } from "../imports/importSession.service";
import { bankService } from "../bank/bank.service";
import { connectionsService } from "./connections.service";
import { sealCredentials } from "./credentialsCipher";
import { STUB_LOAN } from "../../testing/scraperStub";
import { STUB_LOAN_DIGITS, STUB_LOANS_TRACKS } from "../../testing/fakeLoanDetails";
import { bankWorkbook, cardWorkbook } from "./scrapeWorkbook";
import { connectionSync } from "./connectionSync.service";
import type { ScraperFactory, ScraperOptions } from "./scraperAdapter";
import { isolatedScraperFactory } from "./scraperIsolation";
import { json } from "../journey/journey.utils";

// Off by default: only the standing-orders failure test turns the stored-rows read into a failure.
const evidenceFailure = vi.hoisted(() => ({ on: false }));
vi.mock("../bank/statementCommitments.service", async (importOriginal) => {
  const original = await importOriginal<typeof import("../bank/statementCommitments.service")>();
  return { ...original, accountEvidence: (...args: Parameters<typeof original.accountEvidence>) => (evidenceFailure.on ? Promise.reject(new Error("db read failed")) : original.accountEvidence(...args)) };
});

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
// Every bank sync: reading the bank's standing orders and documents is not approved (CLAUDE.md §7), and a few rows are too short to infer them.
const NOT_COLLECTED = " · לא נאספו: זיהוי הוראות קבע, אימות הוראות קבע, מסמכי בנק — ראו פירוט";
// The loans department disabled, not opened, or its details blocked: one gap, the loan's details (syncStageStatus.ts).
const LOANS_NOT_COLLECTED = " · לא נאספו: פרטי הלוואות, זיהוי הוראות קבע, אימות הוראות קבע, מסמכי בנק — ראו פירוט";
// Inferred from enough months: only the bank's own pages are missing.
const PAGES_NOT_COLLECTED = " · לא נאספו: אימות הוראות קבע, מסמכי בנק — ראו פירוט";
const STANDING_ORDERS_SHORT = ["standing_orders_detection skipped WINDOW_TOO_SHORT 0", "standing_orders_verification blocked NOT_APPROVED", "bank_documents blocked NOT_APPROVED"];
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

  describe("the balance check against the bank site, after approval", () => {
    type Check = { status: string; ourBalance: number | null; gap: number | null; asOf: string | null } | null;
    async function approvedSync(siteBalance: number) {
      const connection = await bankConnection();
      await (await connectionSync.start(userId, connection.id, fakeFactory({ success: true, accounts: [{ accountNumber: "1", balance: siteBalance, txns: [txn("חדש", -30)] }] }).factory)).done;
      const before = (await connectionsService.get(userId, connection.id)).syncs[0].outcome as unknown as Array<{ balanceCheck: Check }>;
      expect(before[0].balanceCheck).toBeNull();
      const session = await importSessions.get(userId, (await sessionOf(connection.id)).importSessionId!);
      const committed = await importSessions.commit(userId, session.id, session.version, []);
      expect(committed.status).not.toBe("failed");
      await importSessions.finish(userId, session.id);
      return async () => ((await connectionsService.get(userId, connection.id)).syncs[0].outcome as unknown as Array<{ balanceCheck: Check }>)[0].balanceCheck;
    }

    it("compares as of the last synced row and says they match", async () => {
      await prisma.bankAccount.update({ where: { id: accountId }, data: { initialBalance: 1000 } });
      const check = await approvedSync(970);
      expect(await check()).toEqual({ status: "match", ourBalance: 970, gap: 0, asOf: "2026-09-10" });
      // A row dated after the sync is not part of what the site's balance covered.
      await prisma.bankTransaction.create({ data: { userId, bankAccountId: accountId, transactionDate: new Date(Date.now() - 86400_000), description: "אחרי הרענון", amount: 50, type: "withdrawal" } });
      expect(await check()).toMatchObject({ status: "match", gap: 0 });
    });

    it("names a gap computed on the server", async () => {
      await prisma.bankAccount.update({ where: { id: accountId }, data: { initialBalance: 1000 } });
      expect(await (await approvedSync(950))()).toEqual({ status: "gap", ourBalance: 970, gap: 20, asOf: "2026-09-10" });
    });

    it("does not compare when our opening balance is unknown — that would show the whole balance as a gap", async () => {
      expect(await (await approvedSync(970))()).toMatchObject({ status: "unknown", ourBalance: null, gap: null });
    });

    it("a balance she copied from the same sync is not a check of it", async () => {
      await prisma.bankAccount.update({ where: { id: accountId }, data: { anchorBalance: 970, anchorDate: new Date("2026-09-10") } });
      expect(await (await approvedSync(970))()).toMatchObject({ status: "circular", gap: null });
    });
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
    expect((await latestSync(connection.id)).message).toBe(`לא נמצאו תנועות חדשות לאישור${LOANS_NOT_COLLECTED}`);
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

describe("extras read after the checking account", () => {
  const loan = { ...STUB_LOAN, interestType: "prime" as const, loanNumber: "LN-58213", principalBalance: 412345.67, name: "https://apps.fibi.co.il/x?code=sso-77e" };
  const stored = async () => ({
    loans: await prisma.loan.count({ where: { userId } }),
    schedule: await prisma.loanScheduleEntry.count({ where: { loan: { userId } } }),
    open: await prisma.importSession.count({ where: { userId, status: { not: "cancelled" } } }),
    notBank: await prisma.importSession.count({ where: { userId, kind: { not: "bank" } } }),
  });

  // Design 2026-11-13: valid extras now become loan-schedule imports (scenarios 4, 11 below). One the import
  // cannot read the same way (a loan number with letters), or a malformed one, still stores nothing.
  it("store nothing when unreadable or malformed, and leave the checking import exactly as without them", async () => {
    const connection = await bankConnection();
    const checking = { success: true, accounts: [{ accountNumber: "1", balance: 10, txns: [txn("שופרסל", -5)] }] };
    const rowsOf = async (result: ScrapeResult) => {
      await (await connectionSync.start(userId, connection.id, fakeFactory(result).factory)).done;
      const sync = await latestSync(connection.id);
      const item = await sessionOf(connection.id);
      const rows = await prisma.importRow.findMany({ where: { sessionId: item.importSessionId! }, orderBy: { rowNumber: "asc" }, select: { normalized: true } });
      return { status: sync.status, message: sync.message, outcome: JSON.stringify(sync.outcome), rows };
    };
    const plain = await rowsOf(checking);
    const before = await stored();
    // A track it could not import is said, never shown as success; a malformed extra with no follow-up report adds nothing.
    expect(plain.message).toBe(`דוח אחד מחכה לאישור במסך הייבוא${LOANS_NOT_COLLECTED}`);
    const cases: Array<[ScrapeExtras, string]> = [[{ loans: [loan], errors: [] }, LOANS_NOT_COLLECTED], [{ errors: ["EXTRAS_INVALID"] }, LOANS_NOT_COLLECTED]];
    for (const [extras, suffix] of cases) {
      const withExtras = await rowsOf({ ...checking, extras });
      expect(withExtras.status).toBe("succeeded");
      expect(withExtras.rows).toEqual(plain.rows);
      expect(withExtras.message).toBe(plain.message?.replace(LOANS_NOT_COLLECTED, suffix));
      expect(withExtras.outcome).not.toMatch(/58213|412345|sso-77e/);
    }
    // Each sync cancels the unapproved import of the one before: one open bank import, nothing else.
    expect(await stored()).toEqual(before);
    expect(before).toEqual({ loans: 0, schedule: 0, open: 1, notBank: 0 });
  });

  it("log counts only — no loan number, balance or one-time sign-in link", async () => {
    const lines: string[] = [];
    const spies = (["log", "info", "warn", "error"] as const).map((level) => vi.spyOn(console, level).mockImplementation((...args: unknown[]) => { lines.push(args.map(String).join(" ")); }));
    try {
      const connection = await bankConnection();
      await (await connectionSync.start(userId, connection.id, fakeFactory({ success: true, accounts: [{ accountNumber: "1", txns: [txn("שופרסל", -5)] }], extras: { loans: [loan, STUB_LOAN_DIGITS], errors: [] } }).factory)).done;
    } finally {
      spies.forEach((spy) => spy.mockRestore());
    }
    const logged = lines.join("\n");
    // One track stored for her approval, one skipped by code: counts and codes, nothing the bank stated.
    expect(logged).toContain("loan_schedule_import=partial/IDENTIFIER_UNREADABLE(1)");
    for (const value of ["58213", "412345", "sso-77e", "6.5", "90001", "3000", "1015"]) expect(logged, value).not.toContain(value);
  });
});

describe("a probe run (CONNECTION_URL_PROBE)", () => {
  let root: string;
  beforeEach(async () => { root = await mkdtemp(path.join(os.tmpdir(), "mj-probe-sync-")); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });
  const stub = path.resolve(__dirname, "../../testing/scraperStub.ts");
  const probing = () => isolatedScraperFactory({ library: stub, officialLibrary: stub, runRoot: path.join(root, "runs"), urlProbe: true, probeRoot: path.join(root, "probes") });
  const nothingStored = async (connectionId: number, filesBefore: number) => {
    expect(await prisma.importSession.count({ where: { userId } })).toBe(0);
    expect(await prisma.bankTransaction.count({ where: { userId } })).toBe(0);
    expect(await prisma.financialConnection.findUniqueOrThrow({ where: { id: connectionId } })).toMatchObject({ verifiedAt: null, lastSyncAt: null, blockedReason: null });
    expect((await readdir(storage, { recursive: true })).length).toBe(filesBefore);
    // Never created when the run is refused before any browser.
    expect(await readdir(path.join(root, "runs")).catch(() => [])).toEqual([]);
  };

  it("stores nothing of her account — no import, no file, not even a verified sign-in — whatever the window's module returns", async () => {
    const filesBefore = (await readdir(storage, { recursive: true })).length;
    // The stub returns her checking rows here; the real officialLogin never fetches them in a probe run.
    const connection = await connectionsService.create(userId, { provider: "beinleumi", loginMethod: "official_window", bankAccountId: accountId });
    await (await connectionSync.start(userId, connection.id, probing())).done;
    const sync = await latestSync(connection.id);
    expect(sync).toMatchObject({ status: "failed", errorType: "PROBE_DONE", outcome: [] });
    expect(sync.message).toContain("לא נקראו ולא נשמרו");
    await nothingStored(connection.id, filesBefore);
  }, 60_000);

  it("refuses a password connection before any browser opens, and says so", async () => {
    const filesBefore = (await readdir(storage, { recursive: true })).length;
    const connection = await bankConnection();
    await (await connectionSync.start(userId, connection.id, probing())).done;
    const sync = await latestSync(connection.id);
    expect(sync).toMatchObject({ status: "failed", errorType: "APP" });
    expect(sync.message).toContain("רק בכניסה בחלון הרשמי");
    await nothingStored(connection.id, filesBefore);
  }, 60_000);
});

describe("what a sync writes to the server log (CLAUDE.md §7)", () => {
  it("never logs her credentials, account number, email or a bank URL — on success or failure", async () => {
    const planted = { username: "planted-user-7d1", password: "Pl4nted!Secret", id: "039876543", account: "12-345-678901", email: "planted@bank.test", url: "https://www.fibi.co.il/private/?t=tok-31c" };
    const lines: string[] = [];
    const capture = (...args: unknown[]) => { lines.push(args.map((arg) => (arg instanceof Error ? arg.message : String(arg))).join(" ")); };
    const spies = (["log", "info", "warn", "error"] as const).map((level) => vi.spyOn(console, level).mockImplementation(capture));
    try {
      const failing = await legacyConnection("beinleumi", { username: planted.username, password: planted.password, id: planted.id });
      await (await connectionSync.start(userId, failing.id, fakeFactory({ success: false, errorType: "GENERIC",
        errorMessage: `login rejected for ${planted.username} ${planted.password} id ${planted.id} at ${planted.url} contact ${planted.email}` }).factory)).done;
      await prisma.financialConnection.delete({ where: { id: failing.id } });

      const throwing = await legacyConnection("beinleumi", { username: planted.username, password: planted.password, id: planted.id });
      const thrower: ScraperFactory = async () => ({ onProgress() {}, cancel() {}, async scrape() { throw new Error(`crashed for ${planted.username}/${planted.password} at ${planted.url}`); } });
      await (await connectionSync.start(userId, throwing.id, thrower)).done;
      await prisma.financialConnection.delete({ where: { id: throwing.id } });

      const working = await legacyConnection("beinleumi", { username: planted.username, password: planted.password, id: planted.id });
      await (await connectionSync.start(userId, working.id, fakeFactory({ success: true, accounts: [{ accountNumber: planted.account, balance: 10, txns: [txn("שופרסל", -5)] }] }).factory)).done;
    } finally {
      spies.forEach((spy) => spy.mockRestore());
    }
    const logged = lines.join("\n");
    expect(lines.length).toBeGreaterThan(0);
    for (const value of Object.values(planted)) expect(logged, value).not.toContain(value);
    expect(logged).not.toContain("tok-31c");
  });
});

// Bank sync → loans (design 2026-11-13). Loan data reaches the DB only as a loan-schedule import she approves (§7).
describe("loans after the checking account", () => {
  const LOAN_LINES = [txn("הלוואה - תשלום קרן 90001", -1000), txn("הלוואה - תשלום ריבית 90001", -15)];
  const officialConnection = () => connectionsService.create(userId, { provider: "beinleumi", bankAccountId: accountId, loginMethod: "official_window" });
  const placeholder = () => prisma.loan.create({ data: { userId, loanName: "הלוואה מהדף", loanType: "bank", monthlyPayment: 2015, startDate: new Date("2026-08-10"), loanNumber: "90001", scheduleSource: "statement" } });
  const stagesOf = async (connectionId: number) => ((await latestSync(connectionId)).outcome as unknown as SyncOutcomeItem[])[0].stages
    ?.map((s) => `${s.stage} ${s.state} ${s.code ?? "-"}${s.count === undefined ? "" : ` ${s.count}`}`);
  const outcomeOf = async (connectionId: number) => (await latestSync(connectionId)).outcome as unknown as SyncOutcomeItem[];
  const loanSessions = (status?: string) => prisma.importSession.findMany({ where: { userId, kind: "loan_schedule", ...(status ? { status } : {}) }, orderBy: { createdAt: "asc" } });

  /** Like the worker after the checking fetch: asks the parent's real decision, then reports `extras(decision)`. */
  function loansFactory(txns: ScrapedTransaction[], extras: (decision: LoanFollowUpDecision) => Partial<ScrapeExtras>) {
    const decisions: LoanFollowUpDecision[] = [];
    const factory: ScraperFactory = async (options) => {
      let listener: (type: string) => void = () => {};
      return {
        onProgress(next) { listener = next; },
        cancel() {},
        async scrape() {
          listener("LOGGING_IN");
          listener("LOGIN_SUCCESS");
          const checking = { success: true, accounts: [{ accountNumber: "1", txns }] };
          const decision = await options.decideFollowUp!(checking);
          decisions.push(decision);
          return { ...checking, extras: { errors: [], ...extras(decision) } };
        },
      };
    };
    return { factory, decisions };
  }
  const reported = (department: string, details: string, more: Partial<ScrapeExtras> = {}) => () => ({ ...more, followUp: { department, details } as LoanFollowUpReport });
  const sync = async (connectionId: number, factory: ScraperFactory) => { await (await connectionSync.start(userId, connectionId, factory)).done; return latestSync(connectionId); };

  // Scenarios 2 and 3.
  it("brings the checking rows to the bank import and, with no loan line or waiting loan, neither moves nor reads", async () => {
    const connection = await officialConnection();
    const { factory, decisions } = loansFactory([txn("שופרסל", -5)], (d) => (d.loans ? reported("landed", "NOT_APPROVED")() : reported("NOT_NEEDED", "NOT_RUN")()));
    const done = await sync(connection.id, factory);
    expect(decisions).toEqual([{ loans: false, standingOrders: false }]);
    expect(done).toMatchObject({ status: "succeeded", message: `דוח אחד מחכה לאישור במסך הייבוא${NOT_COLLECTED}` });
    const outcome = await outcomeOf(connection.id);
    expect(outcome).toHaveLength(1);
    expect(await prisma.importSession.findUniqueOrThrow({ where: { id: outcome[0].importSessionId! } })).toMatchObject({ kind: "bank", status: "ready_for_review" });
    expect(await stagesOf(connection.id)).toEqual(["checking done - 1", "loan_detection skipped NO_LOAN_LINES 0", "loans_department skipped NOT_NEEDED", "loan_details skipped NOT_NEEDED", "loan_schedule_import skipped - 0", ...STANDING_ORDERS_SHORT]);
  });

  // Scenarios 4 and 10.
  it("offers a read track for approval, writes no loan before it, and the approval creates it and carves the statement loan", async () => {
    const connection = await officialConnection();
    const statementLoan = await placeholder();
    const { factory, decisions } = loansFactory([txn("שופרסל", -5), ...LOAN_LINES], (d) => (d.loans ? reported("landed", "READ", { loans: [STUB_LOAN_DIGITS] })() : {}));
    const done = await sync(connection.id, factory);
    expect(decisions).toEqual([{ loans: true, standingOrders: false }]);
    expect(done).toMatchObject({ status: "succeeded", message: `דוח אחד מחכה לאישור במסך הייבוא${NOT_COLLECTED}` });
    expect(await stagesOf(connection.id)).toEqual(["checking done - 3", "loan_detection done - 1", "loans_department done -", "loan_details done - 1", "loan_schedule_import done - 1", ...STANDING_ORDERS_SHORT]);
    const [account, schedule] = await outcomeOf(connection.id);
    expect(account.kind).toBeUndefined();
    expect(schedule).toMatchObject({ kind: "loan_schedule", key: "loan:90001:301", target: "הלוואה 90001 · מסלול 301", rows: 3, importSessionId: expect.any(String) });
    expect(await prisma.importSession.findUniqueOrThrow({ where: { id: schedule.importSessionId! } })).toMatchObject({ kind: "loan_schedule", origin: "sync", status: "ready_for_review" });
    // Nothing in the loan tables before she approves.
    expect(await prisma.loan.count({ where: { userId, scheduleSource: "bank_file" } })).toBe(0);
    expect(await prisma.loanScheduleEntry.count({ where: { loan: { userId } } })).toBe(0);
    expect(Number((await prisma.loan.findUniqueOrThrow({ where: { id: statementLoan.id } })).monthlyPayment)).toBe(2015);

    // Her approval, through the import screen's own API.
    const token = crypto.randomBytes(32).toString("hex");
    await prisma.gateSession.create({ data: { userId, tokenHash: crypto.createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 600_000) } });
    const headers = { Cookie: `${sessionCookieName}=${token}`, "X-CSRF-Token": csrfForSession(token), Origin: "http://localhost:5173" };
    const session = await request(app).get(`/api/imports/sessions/${schedule.importSessionId}`).set(headers);
    expect(session.status).toBe(200);
    expect((await request(app).post(`/api/imports/sessions/${schedule.importSessionId}/commit`).set(headers).send({ version: session.body.version })).status).toBe(200);
    expect((await request(app).post(`/api/imports/sessions/${schedule.importSessionId}/complete`).set(headers).send({})).status).toBe(200);

    const loans = await prisma.loan.findMany({ where: { userId, scheduleSource: "bank_file" }, include: { schedule: true } });
    expect(loans).toHaveLength(1);
    expect(loans[0]).toMatchObject({ loanNumber: "90001", trackNumber: "301" });
    expect(loans[0].schedule).toHaveLength(3);
    expect(Number(loans[0].currentBalance)).toBe(STUB_LOAN_DIGITS.principalBalance);
    // The statement loan held the whole day's debit; the track's payment is carved out of it.
    expect(Number((await prisma.loan.findUniqueOrThrow({ where: { id: statementLoan.id } })).monthlyPayment)).toBe(2015 - 1015);
    // Approving the schedule approves nothing else: the checking import still waits for her.
    expect(await prisma.importSession.findUniqueOrThrow({ where: { id: account.importSessionId! } })).toMatchObject({ status: "ready_for_review" });
  });

  // Scenario 5.
  it("makes one import per track of every loan, each under its own key", async () => {
    const connection = await officialConnection();
    await sync(connection.id, loansFactory([txn("שופרסל", -5), ...LOAN_LINES], reported("landed", "READ", { loans: STUB_LOANS_TRACKS })).factory);
    const [, ...schedules] = await outcomeOf(connection.id);
    expect(schedules.map((item) => item.key)).toEqual(["loan:90001:301", "loan:90002:301", "loan:90002:302"]);
    expect(new Set(schedules.map((item) => item.importSessionId)).size).toBe(3);
    expect((await stagesOf(connection.id))?.at(-4)).toBe("loan_schedule_import done - 3");
    expect(await loanSessions("ready_for_review")).toHaveLength(3);
    expect((await latestSync(connection.id)).message).toBe(`דוח אחד מחכה לאישור במסך הייבוא${NOT_COLLECTED}`);
  });

  // A monthly debit in the checking rows is inferred, never verified; the bank's own pages stay blocked (§7).
  it("reports standing orders inferred from the checking rows, the bank's pages as not collected, and imports nothing twice on a re-sync", async () => {
    const connection = await officialConnection();
    // The same day of the last three months, inside the first sync's 90 days.
    const monthsBack = (n: number) => { const d = new Date(); d.setUTCDate(Math.min(d.getUTCDate(), 28) - 1); d.setUTCMonth(d.getUTCMonth() - n); return at(d.toISOString().slice(0, 10)); };
    const rows = [0, 1, 2].map((n) => txn("חברת החשמל", -120, { date: monthsBack(n) }));
    const again = () => sync(connection.id, loansFactory(rows.map((r) => ({ ...r })), reported("NOT_NEEDED", "NOT_RUN")).factory);
    const done = await again();
    expect(done).toMatchObject({ status: "succeeded", message: `דוח אחד מחכה לאישור במסך הייבוא${PAGES_NOT_COLLECTED}` });
    const stages = ["checking done - 3", "loan_detection skipped NO_LOAN_LINES 0", "loans_department skipped NOT_NEEDED", "loan_details skipped NOT_NEEDED", "loan_schedule_import skipped - 0",
      "standing_orders_detection done INFERRED 1", "standing_orders_verification blocked NOT_APPROVED", "bank_documents blocked NOT_APPROVED"];
    expect(await stagesOf(connection.id)).toEqual(stages);
    // Inferred only: nothing becomes a recurring payment from the sync itself.
    expect(await prisma.recurringPayment.count({ where: { userId } })).toBe(0);

    const first = (await outcomeOf(connection.id))[0].importSessionId!;
    const committed = await importSessions.commit(userId, first, (await prisma.importSession.findUniqueOrThrow({ where: { id: first } })).version);
    await importSessions.finish(userId, committed.id);
    expect(await prisma.bankTransaction.count({ where: { userId } })).toBe(3);

    // Stored now: the same rows come back in the overlap and are counted once, and no second import is offered.
    await again();
    expect((await stagesOf(connection.id))?.slice(5)).toEqual(stages.slice(5));
    const resynced = (await outcomeOf(connection.id))[0];
    expect(await prisma.importSession.count({ where: { userId, kind: "bank", status: { in: ["ready_for_review", "review"] } } })).toBe(resynced.importSessionId ? 1 : 0);
    if (resynced.importSessionId) {
      expect((await prisma.importRow.findMany({ where: { sessionId: resynced.importSessionId } })).map((r) => r.resolution)).not.toContain("include");
    }
    expect(await prisma.bankTransaction.count({ where: { userId } })).toBe(3);
  });

  it("a failed read of the stored rows fails only the standing-orders detection: the sync succeeds and lists it as not collected", async () => {
    const connection = await officialConnection();
    // Rows that are inferred as a standing order when the read works, so only the failure can put it in the message.
    const monthsBack = (n: number) => { const d = new Date(); d.setUTCDate(Math.min(d.getUTCDate(), 28) - 1); d.setUTCMonth(d.getUTCMonth() - n); return at(d.toISOString().slice(0, 10)); };
    const rows = [0, 1, 2].map((n) => txn("חברת החשמל", -120, { date: monthsBack(n) }));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    evidenceFailure.on = true;
    try {
      const done = await sync(connection.id, loansFactory(rows, reported("NOT_NEEDED", "NOT_RUN")).factory);
      expect(done).toMatchObject({ status: "succeeded", message: "דוח אחד מחכה לאישור במסך הייבוא · לא נאספו: זיהוי הוראות קבע, אימות הוראות קבע, מסמכי בנק — ראו פירוט" });
      expect((await stagesOf(connection.id))?.slice(5)).toEqual(["standing_orders_detection failed ERROR 0", "standing_orders_verification blocked NOT_APPROVED", "bank_documents blocked NOT_APPROVED"]);
      expect(await prisma.importRow.count({ where: { sessionId: (await outcomeOf(connection.id))[0].importSessionId! } })).toBe(3);
      const presented = (await connectionsService.get(userId, connection.id)).syncs[0];
      expect(presented.incomplete).toBe(true);
      expect(presented.outcome[0].stages?.[5]).toMatchObject({ stage: "standing_orders_detection", status: "failed" });
    } finally {
      evidenceFailure.on = false;
      error.mockRestore();
    }
  });

  // A sync stored before statuses existed must read exactly like a new one: the API computes them, the page never does.
  it.each<[string, SyncStage[], SyncStageStatus[], boolean]>([
    ["with gaps", [
      { stage: "checking", state: "done", code: null, count: 4 }, { stage: "loan_detection", state: "partial", code: "AMBIGUOUS", count: 1 },
      { stage: "loans_department", state: "skipped", code: "DISABLED" }, { stage: "loan_details", state: "blocked", code: "NOT_APPROVED" },
      { stage: "loan_schedule_import", state: "skipped", code: null, count: 0 }, { stage: "standing_orders_detection", state: "skipped", code: "WINDOW_TOO_SHORT", count: 0 },
    ], ["done", "awaiting_approval", "unavailable", "blocked", "not_needed", "unavailable"], true],
    ["waiting for her only", [
      { stage: "checking", state: "done", code: null, count: 4 }, { stage: "loan_detection", state: "partial", code: "AMBIGUOUS", count: 1 },
      { stage: "loan_schedule_import", state: "done", code: null, count: 1 }, { stage: "standing_orders_detection", state: "skipped", code: "NO_RECURRING", count: 0 },
    ], ["done", "awaiting_approval", "awaiting_approval", "not_needed"], false],
  ])("an old stored sync %s gets its statuses and incomplete flag at read time", async (_case, stages, statuses, incomplete) => {
    const connection = await officialConnection();
    const item: SyncOutcomeItem = { key: `bank:${accountId}`, importSessionId: null, target: "חשבון הבנק", rows: 4, skippedPending: 0, skippedForeign: 0, skippedZero: 0, storedThrough: null, pending: [], foreign: [], stages };
    await prisma.connectionSync.create({ data: { connectionId: connection.id, userId, status: "succeeded", method: "official_window", message: "דוח אחד מחכה לאישור במסך הייבוא", outcome: json([item]), finishedAt: new Date() } });
    const presented = (await connectionsService.get(userId, connection.id)).syncs[0];
    expect(presented.outcome[0].stages?.map((s) => s.status)).toEqual(statuses);
    expect(presented.incomplete).toBe(incomplete);
  });

  // Scenarios 7 and 8: the checking import stands; the stages and the message say what is missing.
  it.each<[string, () => Partial<ScrapeExtras>, string[]]>([
    ["signed out on the way to the loans page", reported("SESSION_LOST", "NOT_RUN"), ["loans_department failed SESSION_LOST", "loan_details skipped NOT_RUN"]],
    ["the loan's details page was not there", reported("landed", "UNAVAILABLE"), ["loans_department done -", "loan_details failed UNAVAILABLE"]],
    ["the details step is not approved", reported("landed", "NOT_APPROVED"), ["loans_department done -", "loan_details blocked NOT_APPROVED"]],
  ])("%s: the checking rows are imported, nothing else, and it says the loan details are incomplete", async (_case, extras, followUp) => {
    const connection = await officialConnection();
    const done = await sync(connection.id, loansFactory([txn("שופרסל", -5), ...LOAN_LINES], extras).factory);
    expect(done).toMatchObject({ status: "succeeded", message: `דוח אחד מחכה לאישור במסך הייבוא${LOANS_NOT_COLLECTED}` });
    expect(await stagesOf(connection.id)).toEqual(["checking done - 3", "loan_detection done - 1", ...followUp, "loan_schedule_import skipped - 0", ...STANDING_ORDERS_SHORT]);
    const outcome = await outcomeOf(connection.id);
    expect(outcome).toHaveLength(1);
    expect(await prisma.importRow.count({ where: { sessionId: outcome[0].importSessionId! } })).toBe(3);
    expect(await loanSessions()).toEqual([]);
  });

  // Scenario 9.
  it("a malformed read stores nothing; of several tracks, only the readable ones become imports", async () => {
    const connection = await officialConnection();
    await sync(connection.id, loansFactory([txn("שופרסל", -5), ...LOAN_LINES], reported("landed", "READ", { errors: ["EXTRAS_INVALID"] })).factory);
    expect((await stagesOf(connection.id))?.slice(3, 5)).toEqual(["loan_details failed EXTRAS_INVALID", "loan_schedule_import skipped - 0"]);
    expect(await loanSessions()).toEqual([]);

    const incomplete = { ...STUB_LOAN_DIGITS, trackNumber: "302", schedule: STUB_LOAN_DIGITS.schedule.map((r, i) => (i ? r : { ...r, principal: null })) };
    const linked = { ...STUB_LOAN_DIGITS, trackNumber: "303", indexLinked: true };
    const done = await sync(connection.id, loansFactory([txn("שופרסל", -6), ...LOAN_LINES], reported("landed", "READ", { loans: [STUB_LOAN as ScrapedLoan, STUB_LOAN_DIGITS, incomplete, linked] })).factory);
    expect((await stagesOf(connection.id))?.at(-4)).toBe("loan_schedule_import partial IDENTIFIER_UNREADABLE 1");
    expect(done.message).toContain(LOANS_NOT_COLLECTED);
    expect((await outcomeOf(connection.id)).slice(1).map((item) => item.key)).toEqual(["loan:90001:301"]);
    expect(await loanSessions()).toHaveLength(1);
  });

  // Scenario 11: the same loan read again is the same file, so it is never offered or stored twice.
  it("syncing the same loan again leaves one open import and one loan; after approval it says the schedule is already in", async () => {
    const connection = await officialConnection();
    const again = () => sync(connection.id, loansFactory([txn("שופרסל", -5), ...LOAN_LINES], reported("landed", "READ", { loans: [structuredClone(STUB_LOAN_DIGITS)] })).factory);
    await again();
    await again();
    const [first, second] = await loanSessions();
    expect([first.status, second.status]).toEqual(["cancelled", "ready_for_review"]);
    expect(second.fileHash).toBe(first.fileHash);
    expect(await readFile(documentStorage.resolve(second.storagePath)!)).toEqual(await readFile(documentStorage.resolve(first.storagePath)!));
    expect((await outcomeOf(connection.id))[1].importSessionId).toBe(second.id);

    const committed = await importSessions.commit(userId, second.id, second.version);
    await importSessions.finish(userId, committed.id);
    expect(await prisma.loan.count({ where: { userId } })).toBe(1);

    await again();
    expect((await outcomeOf(connection.id))[1]).toMatchObject({ kind: "loan_schedule", importSessionId: null, note: "הלוח הזה כבר נקלט" });
    expect((await loanSessions()).map((s) => s.status)).toEqual(["cancelled", "completed"]);
    expect(await prisma.loan.count({ where: { userId } })).toBe(1);
    expect(await prisma.loanScheduleEntry.count({ where: { loan: { userId } } })).toBe(3);
  });

  // CLAUDE.md §7 A2: what the bank's loans and standing-orders pages showed, each one import she approves.
  describe("the bank's own pages (A2)", () => {
    const SNAPSHOT: ScrapedLoan = { ...STUB_LOAN_DIGITS, loanNumber: "0108", trackNumber: null, asOf: "2026-11-01", principalBalance: 50000, indexLinked: false,
      nextPaymentAmount: 1010, endDate: "2030-11-10", paymentsMade: 10, paymentsTotal: 60, schedule: [] };
    const ORDERS: ScrapedStandingOrder[] = [
      { payee: "חברת החשמל", amount: 125, dayOfMonth: 10, kind: "standing_order", status: "active", reference: "4321", lastChargeDate: null },
      { payee: "ארנונה עירונית", amount: 400, dayOfMonth: 1, kind: "standing_order", status: "active", reference: null, lastChargeDate: null },
    ];
    const read: DepartmentFollowUp = { department: "landed", details: "READ" };
    const pages = (more: Partial<ScrapeExtras>, loans: DepartmentFollowUp = read, standingOrders: DepartmentFollowUp = read) => () =>
      ({ loans: [structuredClone(SNAPSHOT)], standingOrders: structuredClone(ORDERS), ...more, followUp: { ...loans, standingOrders } });
    const dayTen = (n: number) => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - n, 10)); };
    const stageOf = async (connectionId: number, name: string) => (await stagesOf(connectionId))?.find((line) => line.startsWith(`${name} `));
    const snapshotOf = async <T,>(id: string) => (((await prisma.importSession.findUniqueOrThrow({ where: { id } })).preview as unknown as ImportPreview).siteSnapshot as T);
    // Today: the stored rows below are file rows, and the checking import takes only what is after them.
    const today = () => txn("שופרסל", -5, { date: new Date().toISOString() });
    let statementLoanId: number;

    beforeEach(async () => {
      statementLoanId = (await prisma.loan.create({ data: { userId, loanName: "הלוואה 108", loanType: "bank", monthlyPayment: 1000, startDate: new Date("2026-08-10"), loanNumber: "108", scheduleSource: "statement" } })).id;
      for (const n of [1, 2, 3]) await prisma.bankTransaction.create({ data: { userId, bankAccountId: accountId, transactionDate: dayTen(n), description: "חברת החשמל", amount: 120, type: "withdrawal" } });
    });

    it("one sync: two imports with their previews, nothing written before approval, only the allowed writes after, nothing twice on a re-sync", async () => {
      const connection = await officialConnection();
      const again = () => sync(connection.id, loansFactory([today()], pages({})).factory);
      const done = await again();
      expect(done.status).toBe("succeeded");
      const [account, details, orders] = await outcomeOf(connection.id);
      expect(account.kind).toBeUndefined();
      expect(details).toMatchObject({ kind: "loan_details", key: "loan_details", rows: 1, importSessionId: expect.any(String) });
      expect(orders).toMatchObject({ kind: "standing_orders", key: "standing_orders", rows: 2, importSessionId: expect.any(String) });
      expect(await stageOf(connection.id, "loan_details")).toBe("loan_details done - 1");
      expect(await stageOf(connection.id, "loan_schedule_import")).toBe("loan_schedule_import skipped - 0");
      expect(await stageOf(connection.id, "standing_orders_verification")).toBe("standing_orders_verification done - 2");
      expect(await stageOf(connection.id, "bank_documents")).toBe("bank_documents blocked NOT_APPROVED");
      // The figures themselves stay in the import's preview; the sync's outcome holds counts only.
      expect(JSON.stringify(await outcomeOf(connection.id))).not.toMatch(/50000|4321|חברת החשמל/);

      for (const id of [details.importSessionId!, orders.importSessionId!]) expect(await prisma.importSession.findUniqueOrThrow({ where: { id } })).toMatchObject({ origin: "sync", status: "ready_for_review" });
      const loanPreview = await snapshotOf<LoanDetailsPreview>(details.importSessionId!);
      expect(loanPreview.kind).toBe("loan_details");
      expect(loanPreview.loans[0]).toMatchObject({ loanNumberLast4: "0108", principalBalance: 50000, match: { loanId: statementLoanId, reason: "matched", checkingLines: 0 } });
      const orderPreview = await snapshotOf<StandingOrdersPreview>(orders.importSessionId!);
      expect(orderPreview.orders.map((o) => [o.payee, o.match.reason, o.match.canAdd]).sort()).toEqual([["ארנונה עירונית", "no_checking_debit", false], ["חברת החשמל", "matched", true]]);

      // Nothing before her approval.
      expect((await prisma.loan.findUniqueOrThrow({ where: { id: statementLoanId } })).currentBalance).toBeNull();
      expect(await prisma.recurringPayment.count({ where: { userId } })).toBe(0);

      // The same read again is the same import.
      await again();
      const resynced = await outcomeOf(connection.id);
      expect(resynced.slice(1).map((item) => item.importSessionId)).toEqual([details.importSessionId, orders.importSessionId]);
      expect(await prisma.importSession.count({ where: { userId, kind: { in: ["loan_details", "standing_orders"] } } })).toBe(2);

      const loanSession = await prisma.importSession.findUniqueOrThrow({ where: { id: details.importSessionId! } });
      await importSessions.finish(userId, (await importSessions.commit(userId, loanSession.id, loanSession.version)).id);
      const orderSession = await prisma.importSession.findUniqueOrThrow({ where: { id: orders.importSessionId! } });
      await importSessions.finish(userId, (await importSessions.commit(userId, orderSession.id, orderSession.version, orderPreview.orders.map((o) => o.key))).id);

      const loan = await prisma.loan.findUniqueOrThrow({ where: { id: statementLoanId } });
      expect([Number(loan.currentBalance), Number(loan.monthlyPayment), loan.startDate.toISOString().slice(0, 10), loan.scheduleSource]).toEqual([50000, 1000, "2026-08-10", "statement"]);
      const payments = await prisma.recurringPayment.findMany({ where: { userId } });
      expect(payments.map((r) => [r.detectedKey, Number(r.amount), r.verifiedSource])).toEqual([["recurring:חברתהחשמל", 120, "bank_site"]]);
      expect(await prisma.expense.count({ where: { userId } })).toBe(0);
      expect(await prisma.loan.count({ where: { userId } })).toBe(1);

      // Approved: the same read once more offers nothing new and adds nothing.
      await again();
      expect((await outcomeOf(connection.id)).slice(1).map((item) => [item.kind, item.importSessionId])).toEqual([["loan_details", null], ["standing_orders", null]]);
      expect(await prisma.importSession.count({ where: { userId, kind: { in: ["loan_details", "standing_orders"] } } })).toBe(2);
      expect(await prisma.recurringPayment.count({ where: { userId } })).toBe(1);
    });

    it("a malformed read: both pages are EXTRAS_INVALID, nothing is offered from them, the checking rows are imported", async () => {
      const connection = await officialConnection();
      const done = await sync(connection.id, loansFactory([today()], pages({ errors: ["EXTRAS_INVALID"] })).factory);
      expect(done.status).toBe("succeeded");
      expect(await stageOf(connection.id, "loan_details")).toBe("loan_details failed EXTRAS_INVALID");
      expect(await stageOf(connection.id, "standing_orders_verification")).toBe("standing_orders_verification failed EXTRAS_INVALID");
      const outcome = await outcomeOf(connection.id);
      expect(outcome).toHaveLength(1);
      expect(await prisma.importRow.count({ where: { sessionId: outcome[0].importSessionId! } })).toBe(1);
      expect(await prisma.importSession.count({ where: { userId, kind: { in: ["loan_details", "standing_orders"] } } })).toBe(0);
    });

    it("signed out on the way: both departments say so, the checking rows are imported, nothing else", async () => {
      const connection = await officialConnection();
      const lost: DepartmentFollowUp = { department: "SESSION_LOST", details: "NOT_RUN" };
      const done = await sync(connection.id, loansFactory([today()], pages({ loans: [], standingOrders: [] }, lost, lost)).factory);
      expect(done.status).toBe("succeeded");
      expect(done.message).toContain("פרטי הלוואות");
      expect(done.message).toContain("אימות הוראות קבע");
      expect(await stagesOf(connection.id)).toEqual(expect.arrayContaining(["loans_department failed SESSION_LOST", "loan_details skipped NOT_RUN", "standing_orders_verification failed SESSION_LOST"]));
      const outcome = await outcomeOf(connection.id);
      expect(outcome).toHaveLength(1);
      expect(await prisma.importRow.count({ where: { sessionId: outcome[0].importSessionId! } })).toBe(1);
    });

    it("the loans page alone not showing a table: unavailable at the source, the standing orders still offered", async () => {
      const connection = await officialConnection();
      await sync(connection.id, loansFactory([today()], pages({ loans: [] }, { department: "landed", details: "UNAVAILABLE" })).factory);
      expect(await stageOf(connection.id, "loan_details")).toBe("loan_details failed UNAVAILABLE");
      const presented = (await connectionsService.get(userId, connection.id)).syncs[0].outcome[0].stages!;
      expect(presented.find((stage) => stage.stage === "loan_details")?.status).toBe("unavailable");
      expect((await outcomeOf(connection.id)).map((item) => item.kind)).toEqual([undefined, "standing_orders"]);
    });

    // Banker: rows of the bank's table we could not place may be a loan she owes, so the read is never a plain "done".
    it("unrecognised rows: what was read is offered for approval, and both pages are still named as not collected", async () => {
      const connection = await officialConnection();
      const lines: string[] = [];
      const spy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => { lines.push(args.map(String).join(" ")); });
      try {
        await sync(connection.id, loansFactory([today()], pages({}, { ...read, rejected: 1 }, { ...read, rejected: 2 })).factory);
      } finally {
        spy.mockRestore();
      }
      const done = await latestSync(connection.id);
      expect(done.status).toBe("succeeded");
      expect(done.message).toContain("פרטי הלוואות");
      expect(done.message).toContain("אימות הוראות קבע");
      const stages = (await outcomeOf(connection.id))[0].stages!;
      expect(stages.find((s) => s.stage === "loan_details")).toEqual({ stage: "loan_details", state: "partial", code: "ROWS_UNRECOGNIZED", count: 1, rejected: 1 });
      expect(stages.find((s) => s.stage === "standing_orders_verification")).toEqual({ stage: "standing_orders_verification", state: "partial", code: "ROWS_UNRECOGNIZED", count: 2, rejected: 2 });
      const presented = (await connectionsService.get(userId, connection.id)).syncs[0];
      expect(presented.outcome[0].stages!.filter((s) => s.code === "ROWS_UNRECOGNIZED").map((s) => s.status)).toEqual(["awaiting_approval", "awaiting_approval"]);
      expect(presented.incomplete).toBe(true);
      const [, details, orders] = await outcomeOf(connection.id);
      expect(details).toMatchObject({ kind: "loan_details", rows: 1, importSessionId: expect.any(String) });
      expect(orders).toMatchObject({ kind: "standing_orders", rows: 2, importSessionId: expect.any(String) });
      for (const id of [details.importSessionId!, orders.importSessionId!]) expect(await prisma.importSession.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "ready_for_review" });
      const logged = lines.join("\n");
      expect(logged).toContain("loan_details=partial/ROWS_UNRECOGNIZED(1) rejected=1");
      expect(logged).toContain("standing_orders_verification=partial/ROWS_UNRECOGNIZED(2) rejected=2");
    });

    it("a read with no unrecognised row is a plain done", async () => {
      const connection = await officialConnection();
      const done = await sync(connection.id, loansFactory([today()], pages({}, { ...read, rejected: 0 }, { ...read, rejected: 0 })).factory);
      expect(await stageOf(connection.id, "loan_details")).toBe("loan_details done - 1");
      expect(await stageOf(connection.id, "standing_orders_verification")).toBe("standing_orders_verification done - 2");
      expect(done.message).not.toContain("פרטי הלוואות");
      expect(done.message).not.toContain("אימות הוראות קבע");
      expect((await outcomeOf(connection.id))[0].stages!.some((s) => "rejected" in s)).toBe(false);
    });
  });

  // The real worker, IPC and stub follow-up (scraperStub.ts loans-*), behind the real connectionSync.
  describe("end to end through the isolated worker", () => {
    let root: string;
    beforeEach(async () => { root = await mkdtemp(path.join(os.tmpdir(), "mj-loans-sync-")); });
    afterEach(async () => { vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); });
    const stub = path.resolve(__dirname, "../../testing/scraperStub.ts");
    // The official window takes no credentials of ours; the stub's scenario travels in their place.
    // The flag off means the parent too: a local .env that turns it on must not decide what this test sees.
    const worker = (credentials: Record<string, string>, { loansDepartment = true, decide }: { loansDepartment?: boolean; decide?: ScraperOptions["decideFollowUp"] } = {}): ScraperFactory => async (options) => {
      if (!loansDepartment) vi.stubEnv("CONNECTION_LOANS_DEPARTMENT", "0");
      const run = await isolatedScraperFactory({ library: stub, officialLibrary: stub, runRoot: path.join(root, "runs"), loansDepartment, departmentRead: loansDepartment ? ["loans"] : [] })(decide ? { ...options, decideFollowUp: decide } : options);
      return { onProgress: (listener) => run.onProgress(listener), cancel: () => run.cancel(), scrape: () => run.scrape(credentials) };
    };

    // §7 A2: the loans page gives a snapshot (last four digits, no rows) — one loan_details import, never a schedule.
    it("decides from the checking rows, moves, and offers the fake's loans-page snapshot for approval", async () => {
      const connection = await officialConnection();
      const done = await sync(connection.id, worker({ mode: "loans-followup", loans: "last4" }));
      expect(done).toMatchObject({ status: "succeeded", message: `דוח אחד מחכה לאישור במסך הייבוא${NOT_COLLECTED}` });
      expect(await stagesOf(connection.id)).toEqual(["checking done - 3", "loan_detection done - 1", "loans_department done -", "loan_details done - 1", "loan_schedule_import skipped - 0", ...STANDING_ORDERS_SHORT]);
      expect((await outcomeOf(connection.id)).map((item) => item.kind)).toEqual([undefined, "loan_details"]);
      expect(await prisma.importSession.count({ where: { userId, kind: "loan_details", origin: "sync", status: "ready_for_review" } })).toBe(1);
      expect(await loanSessions()).toEqual([]);
      expect(await prisma.loan.count({ where: { userId } })).toBe(0);
    }, 60_000);

    // Scenario 17.
    it("with the flag off (the default) never asks or moves, and shows the details step as blocked", async () => {
      const connection = await officialConnection();
      const done = await sync(connection.id, worker({ mode: "loans-followup", loans: "one" }, { loansDepartment: false }));
      expect(done).toMatchObject({ status: "succeeded", message: `דוח אחד מחכה לאישור במסך הייבוא${LOANS_NOT_COLLECTED}` });
      expect(await stagesOf(connection.id)).toEqual(["checking done - 3", "loan_detection done - 1", "loans_department skipped DISABLED", "loan_details blocked NOT_APPROVED", "loan_schedule_import skipped - 0", ...STANDING_ORDERS_SHORT]);
      expect(await loanSessions()).toEqual([]);
    }, 60_000);

    // The details step is not needed with no loan line, but the department itself was off: the page and the message both call it not available.
    it("with the flag off and no loan line in the checking rows, the details step is not needed, and the disabled department is listed as not collected", async () => {
      const connection = await officialConnection();
      const done = await sync(connection.id, worker({ mode: "plain" }, { loansDepartment: false }));
      expect(done).toMatchObject({ status: "succeeded", message: `דוח אחד מחכה לאישור במסך הייבוא${LOANS_NOT_COLLECTED}` });
      expect(await stagesOf(connection.id)).toEqual(["checking done - 1", "loan_detection skipped NO_LOAN_LINES 0", "loans_department skipped DISABLED", "loan_details skipped NOT_NEEDED", "loan_schedule_import skipped - 0", ...STANDING_ORDERS_SHORT]);
      expect(await loanSessions()).toEqual([]);
    }, 60_000);

    // Scenario 15.
    it.each([["crashed", {}, "ERROR"], ["she closed the window", { after: "close" }, "CLOSED"]] as const)(
      "the worker %s after the checking fetch: the rows already read are imported, and the move is reported as such", async (_case, more, department) => {
        const connection = await officialConnection();
        const done = await sync(connection.id, worker({ mode: "loans-crash-after-checking", ...more }));
        expect(done).toMatchObject({ status: "succeeded", message: `דוח אחד מחכה לאישור במסך הייבוא${LOANS_NOT_COLLECTED}` });
        expect((await stagesOf(connection.id))?.slice(0, 4)).toEqual(["checking done - 3", "loan_detection done - 1", `loans_department failed ${department}`, "loan_details skipped NOT_RUN"]);
        expect(await prisma.importRow.count({ where: { sessionId: (await outcomeOf(connection.id))[0].importSessionId! } })).toBe(3);
      }, 60_000);

    it("a cancel during the follow-up wins: cancelled, and nothing is offered for import", async () => {
      const connection = await officialConnection();
      let asked = false;
      const { done } = await connectionSync.start(userId, connection.id, worker({ mode: "loans-followup", loans: "one" }, { decide: () => { asked = true; return new Promise(() => {}); } }));
      await expect.poll(() => asked, { timeout: 30_000 }).toBe(true);
      await connectionSync.cancel(userId, connection.id);
      await done;
      expect(await latestSync(connection.id)).toMatchObject({ status: "cancelled", errorType: "CANCELLED" });
      expect(await prisma.importSession.count({ where: { userId } })).toBe(0);
    }, 60_000);
  });
});
