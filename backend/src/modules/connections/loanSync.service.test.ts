import crypto from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../../config/database";
import { env } from "../../config/env";
import type { LoginMethod, ScrapedLoan, ScrapedTransaction, ScrapeExtras, SyncStage } from "../../types/connections.types";
import { STUB_LOAN } from "../../testing/scraperStub";
import { STUB_LOAN_DIGITS, STUB_LOANS_TRACKS } from "../../testing/fakeLoanDetails";
import { checkingDebits, decideLoanFollowUp, followUpStages, importScrapedLoans, loanDetectionStage } from "./loanSync.service";
import { providerInfo } from "./providers";
import { importSessions } from "../imports/importSession.service";

// Made-up rows; the loan lines are worded as the bank prints them, so the one classifier reads them.
const txn = (description: string, chargedAmount: number, overrides: Partial<ScrapedTransaction> = {}): ScrapedTransaction => ({
  type: "normal", date: "2026-10-09T21:00:00.000Z", processedDate: "2026-10-09T21:00:00.000Z", originalAmount: chargedAmount,
  originalCurrency: "ILS", chargedAmount, chargedCurrency: "ILS", description, status: "completed", ...overrides,
});
const LOAN_DAY = [txn("הלוואה - תשלום קרן 90001", -1000), txn("הלוואה - תשלום ריבית 90001", -15)];

describe("checkingDebits", () => {
  it("takes completed money out by its charged sign, and classifies it with the statement's own classifier", () => {
    const debits = checkingDebits([...LOAN_DAY, txn("משכורת", 7000), txn("בדרך", -9, { status: "pending" }), txn("שופרסל", -50)]);
    expect(debits.map((d) => [d.date.toISOString().slice(0, 10), d.description, d.amount, d.lineKind, d.loanRef])).toEqual([
      ["2026-10-10", "הלוואה - תשלום קרן 90001", 1000, "loan_principal", "90001"],
      ["2026-10-10", "הלוואה - תשלום ריבית 90001", 15, "loan_interest", "90001"],
      ["2026-10-10", "שופרסל", 50, "standard", null],
    ]);
  });
});

describe("loanDetectionStage", () => {
  it("says there were no loan lines when there were none", () => {
    expect(loanDetectionStage([txn("שופרסל", -50), txn("הלוואה שהתקבלה", 5000)])).toEqual({ stage: "loan_detection", state: "skipped", code: "NO_LOAN_LINES", count: 0 });
  });

  it("counts numbered loan payment days", () => {
    const second = LOAN_DAY.map((t) => ({ ...t, date: "2026-09-09T21:00:00.000Z" }));
    expect(loanDetectionStage([...LOAN_DAY, ...second, txn("שופרסל", -50)])).toEqual({ stage: "loan_detection", state: "done", code: null, count: 2 });
  });

  // Scenario 13: a day it cannot tie to one loan number is for her to pick in the import, never guessed.
  it("marks a day it cannot tie to one loan as partial AMBIGUOUS, counting only those days", () => {
    const twoNumbers = [txn("הלוואה - תשלום קרן 90001", -1000), txn("הלוואה - תשלום קרן 90002", -700)].map((t) => ({ ...t, date: "2026-09-14T21:00:00.000Z" }));
    const unnumbered = [txn("הלוואה - תשלום ריבית", -20, { date: "2026-08-19T21:00:00.000Z" })];
    expect(loanDetectionStage([...LOAN_DAY, ...twoNumbers, ...unnumbered])).toEqual({ stage: "loan_detection", state: "partial", code: "AMBIGUOUS", count: 2 });
  });
});

describe("followUpStages", () => {
  const stages = (enabled: boolean, method: LoginMethod, extras: ScrapeExtras | undefined, loanLines = true) =>
    followUpStages(enabled, method, extras, loanLines).map((s: SyncStage) => `${s.stage} ${s.state} ${s.code ?? "-"}${s.count === undefined ? "" : ` ${s.count}`}`);
  const report = (department: string, details: string, more: Partial<ScrapeExtras> = {}) =>
    ({ errors: [], ...more, followUp: { department, details } }) as ScrapeExtras;

  // Scenario 17: default off — no move, and the details step is shown as blocked by policy, not as done.
  it("with the flag off, the move is DISABLED and the details step blocked NOT_APPROVED", () => {
    expect(stages(false, "official_window", undefined)).toEqual(["loans_department skipped DISABLED", "loan_details blocked NOT_APPROVED"]);
    expect(stages(false, "official_window", undefined, false)).toEqual(["loans_department skipped DISABLED", "loan_details skipped NOT_NEEDED"]);
  });

  it("never claims a move for a password login", () => {
    expect(stages(true, "password", undefined)).toEqual(["loans_department skipped NOT_OFFICIAL_WINDOW", "loan_details blocked NOT_APPROVED"]);
  });

  it.each<[string, ScrapeExtras | undefined, string[]]>([
    ["no loans to look for (scenario 3)", report("NOT_NEEDED", "NOT_RUN"), ["loans_department skipped NOT_NEEDED", "loan_details skipped NOT_NEEDED"]],
    ["landed, details not approved", report("landed", "NOT_APPROVED"), ["loans_department done -", "loan_details blocked NOT_APPROVED"]],
    ["landed and read two tracks", report("landed", "READ", { loans: [STUB_LOAN_DIGITS, STUB_LOANS_TRACKS[1]] }), ["loans_department done -", "loan_details done - 2"]],
    ["signed out on the way (scenario 7)", report("SESSION_LOST", "NOT_RUN"), ["loans_department failed SESSION_LOST", "loan_details skipped NOT_RUN"]],
    ["the details page was not there (scenario 8)", report("landed", "UNAVAILABLE"), ["loans_department done -", "loan_details failed UNAVAILABLE"]],
    ["a malformed read (scenario 9)", report("landed", "READ", { errors: ["EXTRAS_INVALID"] }), ["loans_department done -", "loan_details failed EXTRAS_INVALID"]],
    ["no decision in time (scenario 16)", report("NO_DECISION", "NOT_RUN"), ["loans_department failed NO_DECISION", "loan_details skipped NOT_RUN"]],
    ["the window closed (scenario 15)", report("CLOSED", "NOT_RUN"), ["loans_department failed CLOSED", "loan_details skipped NOT_RUN"]],
    ["no report at all", undefined, ["loans_department failed ERROR", "loan_details skipped NOT_RUN"]],
  ])("%s", (_case, extras, expected) => {
    expect(stages(true, "official_window", extras)).toEqual(expected);
  });
});

describe("the parent's loan decision and the loan-schedule imports", () => {
  let userId: number;
  let connectionId: number;
  let storage: string;
  const originalStorage = env.DOCUMENT_STORAGE_DIR;
  const provider = providerInfo("beinleumi")!;
  const checking = (txns: ScrapedTransaction[]) => ({ success: true, accounts: [{ accountNumber: "1", txns }] });
  const placeholder = (data: { loanNumber: string; status?: "active" | "finished" }) => prisma.loan.create({ data: {
    userId, loanName: "הלוואה מהדף", loanType: "bank", monthlyPayment: 2015, startDate: new Date("2026-08-10"), scheduleSource: "statement", ...data,
  } });
  const imported = (loans: unknown[]) => importScrapedLoans(userId, connectionId, provider, { loans: loans as ScrapedLoan[], errors: [] });

  beforeAll(async () => { storage = await mkdtemp(path.join(os.tmpdir(), "mj-loan-sync-")); env.DOCUMENT_STORAGE_DIR = storage; });
  beforeEach(async () => {
    userId = (await prisma.user.create({ data: { name: "__loan_sync_test", email: `${crypto.randomUUID()}@example.test` } })).id;
    const accountId = (await prisma.bankAccount.create({ data: { userId, bankName: "הבינלאומי", accountName: "עו״ש" } })).id;
    connectionId = (await prisma.financialConnection.create({ data: { userId, provider: "beinleumi", kind: "bank", label: "x", loginMethod: "official_window", bankAccountId: accountId } })).id;
  });
  afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); await prisma.user.delete({ where: { id: userId } }); });
  afterAll(async () => { env.DOCUMENT_STORAGE_DIR = originalStorage; await rm(storage, { recursive: true, force: true }); await prisma.$disconnect(); });

  it("moves only for loan lines in the window, or a statement loan still waiting for its schedule", async () => {
    vi.stubEnv("CONNECTION_DEPARTMENT_READ", "");
    expect(await decideLoanFollowUp(userId, checking([txn("שופרסל", -50)]))).toEqual({ loans: false, standingOrders: false });
    expect(await decideLoanFollowUp(userId, checking(LOAN_DAY))).toEqual({ loans: true, standingOrders: false });
    await placeholder({ loanNumber: "90001", status: "finished" });
    expect(await decideLoanFollowUp(userId, checking([]))).toEqual({ loans: false, standingOrders: false });
    await placeholder({ loanNumber: "90002" });
    expect(await decideLoanFollowUp(userId, checking([]))).toEqual({ loans: true, standingOrders: false });
  });

  // CLAUDE.md §7 A2: the standing-orders page is read only when the read list names it.
  it.each([["loans,standing_orders", true], ["standing_orders", true], ["loans", false], ["", false], ["standing-orders, cheques", false]] as const)(
    "CONNECTION_DEPARTMENT_READ=%o → standingOrders %s, whatever the loans decision", async (list, expected) => {
      vi.stubEnv("CONNECTION_DEPARTMENT_READ", list);
      expect(await decideLoanFollowUp(userId, checking([txn("שופרסל", -50)]))).toEqual({ loans: false, standingOrders: expected });
      expect(await decideLoanFollowUp(userId, checking(LOAN_DAY))).toEqual({ loans: true, standingOrders: expected });
    });

  it("a loans-page snapshot (no rows) is never a schedule import", async () => {
    expect(await imported([{ ...STUB_LOAN_DIGITS, schedule: [] }])).toEqual({ items: [], stage: { stage: "loan_schedule_import", state: "skipped", code: null, count: 0 } });
    expect(await prisma.importSession.count({ where: { userId } })).toBe(0);
  });

  it("stores nothing when nothing was read", async () => {
    expect(await importScrapedLoans(userId, connectionId, provider, undefined)).toEqual({ items: [], stage: { stage: "loan_schedule_import", state: "skipped", code: null, count: 0 } });
    expect(await importScrapedLoans(userId, connectionId, provider, { followUp: { department: "landed", details: "NOT_APPROVED" }, errors: [] })).toMatchObject({ items: [], stage: { state: "skipped" } });
    expect(await prisma.importSession.count({ where: { userId } })).toBe(0);
  });

  // Scenarios 4 and 10: one track → one loan-schedule import from the sync, and no loan until she approves it.
  it("offers a read track as a loan-schedule import for her approval, and writes no loan itself", async () => {
    const { items, stage } = await imported([STUB_LOAN_DIGITS]);
    expect(stage).toEqual({ stage: "loan_schedule_import", state: "done", code: null, count: 1 });
    expect(items).toEqual([{ kind: "loan_schedule", key: "loan:90001:301", target: "הלוואה 90001 · מסלול 301", importSessionId: expect.any(String), rows: 3,
      skippedPending: 0, skippedForeign: 0, skippedZero: 0, storedThrough: null, pending: [], foreign: [] }]);
    const session = await prisma.importSession.findUniqueOrThrow({ where: { id: items[0].importSessionId! } });
    expect(session).toMatchObject({ kind: "loan_schedule", origin: "sync", status: "ready_for_review" });
    expect(session.fileName).toMatch(/^סנכרון הבנק הבינלאומי לוח סילוקין .* 2026-10-31\.xlsx$/);
    expect(await prisma.loan.count({ where: { userId } })).toBe(0);
    // Counts and identity only: no balance, payment or rate from the bank.
    const shown = JSON.stringify(items.map(({ importSessionId: _id, ...item }) => item));
    for (const value of ["3000", "1015", "6000", "prime"]) expect(shown, value).not.toContain(value);
  });

  // Scenario 5: one import per track, each under its own key.
  it("makes one import per track of every loan", async () => {
    const { items, stage } = await imported(STUB_LOANS_TRACKS);
    expect(items.map((item) => item.key)).toEqual(["loan:90001:301", "loan:90002:301", "loan:90002:302"]);
    expect(new Set(items.map((item) => item.importSessionId)).size).toBe(3);
    expect(stage).toMatchObject({ state: "done", count: 3 });
    expect(await prisma.importSession.count({ where: { userId, kind: "loan_schedule", status: "ready_for_review" } })).toBe(3);
  });

  // Scenario 9: what the import cannot read the same way is skipped, named by code, and costs no other track.
  it("imports the readable tracks and names the first reason the others were skipped", async () => {
    const incomplete = { ...STUB_LOAN_DIGITS, trackNumber: "302", schedule: STUB_LOAN_DIGITS.schedule.map((r, i) => (i ? r : { ...r, interest: null })) };
    const { items, stage } = await imported([STUB_LOAN, STUB_LOAN_DIGITS, incomplete, { ...STUB_LOAN_DIGITS, trackNumber: "303", indexLinked: true }]);
    expect(items.map((item) => item.key)).toEqual(["loan:90001:301"]);
    expect(stage).toEqual({ stage: "loan_schedule_import", state: "partial", code: "IDENTIFIER_UNREADABLE", count: 1 });
    expect(await prisma.importSession.count({ where: { userId } })).toBe(1);
  });

  it("fails the stage, not the sync, when no track could be imported — the parser's own check included", async () => {
    const unbalanced = { ...STUB_LOAN_DIGITS, schedule: STUB_LOAN_DIGITS.schedule.map((r, i) => (i ? r : { ...r, balanceAfter: 2500 })) };
    expect((await imported([unbalanced])).stage).toEqual({ stage: "loan_schedule_import", state: "failed", code: "SCHEDULE_REJECTED", count: 0 });
    expect((await imported([STUB_LOAN])).stage).toEqual({ stage: "loan_schedule_import", state: "failed", code: "IDENTIFIER_UNREADABLE", count: 0 });
    expect(await prisma.importSession.count({ where: { userId } })).toBe(0);
  });

  it("names a storage failure IMPORT_FAILED: failed when nothing was saved, partial when another track was", async () => {
    const create = importSessions.create.bind(importSessions);
    vi.spyOn(importSessions, "create").mockImplementation((...args: Parameters<typeof importSessions.create>) => (args[1].includes("90002") ? Promise.reject(new Error("disk full")) : create(...args)));
    expect((await imported([STUB_LOANS_TRACKS[1]])).stage).toEqual({ stage: "loan_schedule_import", state: "failed", code: "IMPORT_FAILED", count: 0 });
    const { items, stage } = await imported([STUB_LOAN_DIGITS, STUB_LOANS_TRACKS[2]]);
    expect(items.map((item) => item.key)).toEqual(["loan:90001:301"]);
    expect(stage).toEqual({ stage: "loan_schedule_import", state: "partial", code: "IMPORT_FAILED", count: 1 });
  });

  it("gives the same track the same file, so a repeat is the earlier import, not a second one", async () => {
    const [first, again] = [await imported([STUB_LOAN_DIGITS]), await imported([structuredClone(STUB_LOAN_DIGITS)])];
    expect(again.items[0].importSessionId).toBe(first.items[0].importSessionId);
    expect(await prisma.importSession.count({ where: { userId } })).toBe(1);
  });
});
