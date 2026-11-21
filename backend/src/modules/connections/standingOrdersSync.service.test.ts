import crypto from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../config/database";
import type { DebitEvidence } from "../../types/commitments.types";
import type { DepartmentFollowUp, LoginMethod, ScrapedTransaction, ScrapeExtras } from "../../types/connections.types";
import { checkingDebits } from "./loanSync.service";
import { BANK_DOCUMENTS_BLOCKED, standingOrdersDetectionStage, standingOrdersStages, standingOrdersVerificationStage } from "./standingOrdersSync.service";

// Made-up rows; dates are Israeli midnight as the library sends them.
const txn = (description: string, chargedAmount: number, day: string): ScrapedTransaction => ({
  type: "normal", date: new Date(new Date(`${day}T00:00:00Z`).getTime() - 3 * 3600_000).toISOString(), processedDate: `${day}T00:00:00.000Z`,
  originalAmount: chargedAmount, originalCurrency: "ILS", chargedAmount, chargedCurrency: "ILS", description, status: "completed",
});
const monthly = (description: string, amount: number, days = ["2026-07-10", "2026-08-10", "2026-09-10"]) => days.map((d) => txn(description, -amount, d));
const evidence = (txns: ScrapedTransaction[]): DebitEvidence => {
  const days = txns.map((t) => new Date(`${t.processedDate.slice(0, 10)}T00:00:00Z`).getTime());
  return { debits: checkingDebits(txns), first: new Date(Math.min(...days)), last: new Date(Math.max(...days)) };
};

describe("standingOrdersDetectionStage", () => {
  it("infers one standing order from the same debit in three months", () => {
    expect(standingOrdersDetectionStage(evidence([...monthly("חברת החשמל", 120), txn("שופרסל", -80, "2026-08-02")])))
      .toEqual({ stage: "standing_orders_detection", state: "done", code: "INFERRED", count: 1 });
  });

  // The words "הוראת קבע" in a checking line are still the bank's description, not the bank's list of orders.
  it("counts a monthly line that says הוראת קבע as inferred, never as verified", () => {
    expect(standingOrdersDetectionStage(evidence(monthly("הוראת קבע - ועד הבית", 250)))).toEqual({ stage: "standing_orders_detection", state: "done", code: "INFERRED", count: 1 });
    expect(standingOrdersVerificationStage(false, "official_window", undefined)).toEqual({ stage: "standing_orders_verification", state: "blocked", code: "NOT_APPROVED" });
  });

  it("does not count a monthly loan payment or a monthly card settlement", () => {
    const rows = [...monthly("הלוואה - תשלום קרן 90001", 1000), ...monthly("הלוואה - תשלום ריבית 90001", 15), ...monthly("כרטיסי אשראי לי - 2349", 2500), ...monthly("עפ״י הרשאה כאל", 900)];
    expect(standingOrdersDetectionStage(evidence(rows))).toEqual({ stage: "standing_orders_detection", state: "skipped", code: "NO_RECURRING", count: 0 });
  });

  // Stored rows keep only the parser's BankLineKind, so a settlement there reads "standard"; the detector re-reads its text.
  it("does not count a card settlement even when its row is marked standard", () => {
    const rows = evidence(monthly("כרטיסי אשראי לי - 2349", 2500));
    expect(standingOrdersDetectionStage({ ...rows, debits: rows.debits.map((d) => ({ ...d, lineKind: "standard" })) }).code).toBe("NO_RECURRING");
  });

  it("says nothing was found when the rows span enough months", () => {
    expect(standingOrdersDetectionStage(evidence([txn("שופרסל", -80, "2026-07-02"), txn("רמי לוי", -60, "2026-08-15"), txn("פז", -200, "2026-09-20")])))
      .toEqual({ stage: "standing_orders_detection", state: "skipped", code: "NO_RECURRING", count: 0 });
  });

  it("says the window is too short — not that there are none — when the rows span under 60 days", () => {
    const short = { stage: "standing_orders_detection", state: "skipped", code: "WINDOW_TOO_SHORT", count: 0 };
    expect(standingOrdersDetectionStage(evidence(monthly("חברת החשמל", 120, ["2026-08-10", "2026-09-10"])))).toEqual(short);
    expect(standingOrdersDetectionStage(evidence([txn("שופרסל", -80, "2026-09-08"), txn("פז", -200, "2026-09-11")]))).toEqual(short);
    expect(standingOrdersDetectionStage(null)).toEqual(short);
  });
});

describe("standingOrdersVerificationStage (CLAUDE.md §7 A2)", () => {
  const stage = (enabled: boolean, extras: ScrapeExtras | undefined, method: LoginMethod = "official_window") => {
    const s = standingOrdersVerificationStage(enabled, method, extras);
    return `${s.state} ${s.code ?? "-"}${s.count === undefined ? "" : ` ${s.count}`}`;
  };
  const report = (standingOrders: DepartmentFollowUp | undefined, more: Partial<ScrapeExtras> = {}): ScrapeExtras =>
    ({ errors: [], ...more, followUp: { department: "landed", details: "READ", ...(standingOrders ? { standingOrders } : {}) } });
  const order = { payee: "ועד הבית", amount: 250, dayOfMonth: 10, kind: "standing_order" as const, status: "active" as const, reference: null, lastChargeDate: null };

  it.each<[string, boolean, ScrapeExtras | undefined, string]>([
    ["flag off, no report", false, undefined, "blocked NOT_APPROVED"],
    ["flag off, follow-up ran for loans only", false, report(undefined), "blocked NOT_APPROVED"],
    ["the worker says not approved", true, report({ department: "landed", details: "NOT_APPROVED" }), "blocked NOT_APPROVED"],
    ["read two orders", true, report({ department: "landed", details: "READ" }, { standingOrders: [order, order] }), "done - 2"],
    ["a report is proof it ran, even with the parent's flag unset", false, report({ department: "landed", details: "READ" }, { standingOrders: [order] }), "done - 1"],
    ["the page showed no readable table", true, report({ department: "landed", details: "UNAVAILABLE" }), "failed UNAVAILABLE"],
    ["no such page in her menu", true, report({ department: "NOT_IN_MENU", details: "NOT_RUN" }), "failed NOT_IN_MENU"],
    ["signed out on the way", true, report({ department: "SESSION_LOST", details: "NOT_RUN" }), "failed SESSION_LOST"],
    ["the read failed", true, report({ department: "landed", details: "FAILED" }), "failed FAILED"],
    ["malformed extras", true, report({ department: "landed", details: "READ" }, { errors: ["EXTRAS_INVALID"] }), "failed EXTRAS_INVALID"],
    ["not needed", true, report({ department: "NOT_NEEDED", details: "NOT_RUN" }), "skipped NOT_NEEDED"],
    ["flag on, follow-up without a standing-orders part", true, report(undefined), "skipped NOT_RUN"],
    ["flag on, no follow-up report at all", true, { errors: [] }, "failed ERROR"],
  ])("%s", (_case, enabled, extras, expected) => {
    expect(stage(enabled, extras)).toBe(expected);
  });

  it("a password login never visits the bank's pages", () => {
    expect(stage(true, undefined, "password")).toBe("skipped NOT_OFFICIAL_WINDOW");
  });

  it("the bank's documents stay blocked: clause B is not approved", () => {
    expect(BANK_DOCUMENTS_BLOCKED).toEqual({ stage: "bank_documents", state: "blocked", code: "NOT_APPROVED" });
  });
});

describe("standingOrdersStages over the account's stored rows", () => {
  let userId: number;
  let accountId: number;
  const stored = (day: string, description: string, amount: number) =>
    prisma.bankTransaction.create({ data: { userId, bankAccountId: accountId, transactionDate: new Date(day), description, amount, type: "withdrawal" } });

  beforeEach(async () => {
    userId = (await prisma.user.create({ data: { name: "__standing_orders_test", email: `${crypto.randomUUID()}@example.test` } })).id;
    accountId = (await prisma.bankAccount.create({ data: { userId, bankName: "הבינלאומי", accountName: "עו״ש" } })).id;
  });
  afterEach(async () => { await prisma.user.delete({ where: { id: userId } }); });
  afterAll(async () => { await prisma.$disconnect(); });

  it("a re-sync's few days are too short alone, but complete the stored months", async () => {
    const resync = [txn("חברת החשמל", -120, "2026-09-10"), txn("שופרסל", -80, "2026-09-11")];
    expect((await standingOrdersStages(userId, accountId, resync))[0]).toMatchObject({ code: "WINDOW_TOO_SHORT", count: 0 });
    await stored("2026-07-10", "חברת החשמל", 120);
    await stored("2026-08-10", "חברת החשמל", 120);
    expect((await standingOrdersStages(userId, accountId, resync)).map((s) => `${s.stage} ${s.state} ${s.code}`)).toEqual([
      "standing_orders_detection done INFERRED", "standing_orders_verification blocked NOT_APPROVED", "bank_documents blocked NOT_APPROVED",
    ]);
  });

  it("counts scraped rows only after the last stored day, so a reworded copy of a stored row is never counted twice", async () => {
    await stored("2026-07-10", "חברת החשמל", 120);
    await stored("2026-08-10", "חברת החשמל", 120);
    await stored("2026-09-20", "שופרסל", 80);
    expect((await standingOrdersStages(userId, accountId, [txn("חברת החשמל", -120, "2026-09-10")]))[0]).toMatchObject({ state: "skipped", code: "NO_RECURRING" });
  });
});
