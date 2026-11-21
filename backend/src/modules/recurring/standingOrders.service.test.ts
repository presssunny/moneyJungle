import crypto from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../config/database";
import { env } from "../../config/env";
import type { DetectedCommitment } from "../../types/commitments.types";
import type { ScrapedStandingOrder } from "../../types/connections.types";
import type { StandingOrdersPreview } from "../../types/siteSnapshot.types";
import { statementCommitmentsService } from "../bank/statementCommitments.service";
import { buildUpcoming } from "../dashboard/cashflow.service";
import { monthTotals } from "../dashboard/dashboard.service";
import { importSessions, type ImportPreview } from "../imports/importSession.service";
import { matchStandingOrders, payeeLink, standingOrdersFile } from "./standingOrders.service";

// Made-up payees and amounts. The banker's ruling of 2026-11-14: the bank's list labels, the checking debit decides (CLAUDE.md §4, §7 A2).
const order = (overrides: Partial<ScrapedStandingOrder> = {}): ScrapedStandingOrder => ({
  payee: "חברת החשמל", amount: 120, dayOfMonth: 10, kind: "standing_order", status: "active", reference: "4321", lastChargeDate: null, ...overrides,
});
const recurring = (name: string, amount: number, dayOfMonth = 10): DetectedCommitment => ({
  key: `recurring:${name.replace(/\s/g, "")}`, kind: "recurring", name, amount, dayOfMonth, months: 3, lastDate: `2026-10-${String(dayOfMonth).padStart(2, "0")}`, nextDate: "2026-11-10", loanNumber: null,
});
const reasons = (orders: ScrapedStandingOrder[], items: DetectedCommitment[]) => matchStandingOrders(orders, items).map((m) => `${m.reason}${m.commitment ? ` ${m.commitment.key}` : ""}`);

describe("matching the bank's list to the checking debits", () => {
  it("matches payee, amount and day; a standing order within 5%, a direct debit within the detector's 15%", () => {
    expect(reasons([order({ amount: 125 })], [recurring("חברת החשמל", 120)])).toEqual(["matched recurring:חברתהחשמל"]);
    expect(reasons([order({ amount: 135 })], [recurring("חברת החשמל", 120)])).toEqual(["no_checking_debit"]);
    expect(reasons([order({ amount: 135, kind: "direct_debit" })], [recurring("חברת החשמל", 120)])).toEqual(["matched recurring:חברתהחשמל"]);
    expect(reasons([order({ amount: 140, kind: "direct_debit" })], [recurring("חברת החשמל", 120)])).toEqual(["no_checking_debit"]);
  });

  // Edge 15.
  it("a direct debit with no amount matches only a single candidate", () => {
    const debit = order({ payee: "הראל ביטוח", amount: null, kind: "direct_debit" });
    expect(reasons([debit], [recurring("הראל ביטוח חיים", 80)])).toEqual(["matched recurring:הראלביטוחחיים"]);
    expect(reasons([debit], [recurring("הראל ביטוח חיים", 80), recurring("הראל ביטוח רכב", 300)])).toEqual(["ambiguous"]);
  });

  // Edge 16.
  it("two orders to one payee and one debit: both ambiguous, neither picked", () => {
    expect(reasons([order({ payee: "ועד הבית", amount: 250, reference: "1" }), order({ payee: "ועד הבית", amount: 250, reference: "2" })], [recurring("ועד הבית", 250)]))
      .toEqual(["ambiguous", "ambiguous"]);
  });

  // Edge 17.
  it("a day up to three apart matches, across a month's end too; four apart does not; no day on the page skips the check", () => {
    expect(reasons([order({ dayOfMonth: 13 })], [recurring("חברת החשמל", 120)])).toEqual(["matched recurring:חברתהחשמל"]);
    expect(reasons([order({ dayOfMonth: 14 })], [recurring("חברת החשמל", 120)])).toEqual(["no_checking_debit"]);
    expect(reasons([order({ dayOfMonth: 30 })], [recurring("חברת החשמל", 120, 2)])).toEqual(["matched recurring:חברתהחשמל"]);
    expect(reasons([order({ dayOfMonth: null })], [recurring("חברת החשמל", 120, 25)])).toEqual(["matched recurring:חברתהחשמל"]);
  });

  // Edge 19.
  it("a short payee inside a longer one is not matched on its own", () => {
    expect(payeeLink("חשמל", "חברת החשמל לישראל")).toBe("fragment");
    expect(payeeLink("חברת החשמל", "חברת החשמל לישראל")).toBe("same");
    expect(reasons([order({ payee: "חשמל" })], [recurring("חברת החשמל לישראל", 120)])).toEqual(["ambiguous"]);
    expect(reasons([order({ payee: "שופרסל" })], [recurring("חברת החשמל", 120)])).toEqual(["no_checking_debit"]);
  });

  it("the same list is the same file", () => {
    expect(standingOrdersFile([order(), order({ payee: "ועד הבית" })])).toEqual(standingOrdersFile([order({ payee: "ועד הבית" }), order()]));
  });
});

describe("approving the bank's list", () => {
  let userId: number;
  let accountId: number;
  let storage: string;
  const originalStorage = env.DOCUMENT_STORAGE_DIR;
  /** Day 10 of the month `n` months before today — real dates, since the detector counts from today. */
  const monthsBack = (n: number) => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - n, 10)); };
  const debit = (n: number, description = "חברת החשמל", amount = 120) =>
    prisma.bankTransaction.create({ data: { userId, bankAccountId: accountId, transactionDate: monthsBack(n), description, amount, type: "withdrawal" } });
  const KEY = "recurring:חברתהחשמל";

  async function approve(orders: ScrapedStandingOrder[], tick: (preview: StandingOrdersPreview) => string[] = () => []) {
    const created = await importSessions.create(userId, `סנכרון הוראות קבע ${crypto.randomUUID()}.json`, standingOrdersFile(orders), { kind: "standing_orders", accountId }, "sync");
    expect(created.status).toBe("ready_for_review");
    const before = (created.preview as unknown as ImportPreview).siteSnapshot as StandingOrdersPreview;
    const committed = await importSessions.commit(userId, created.id, created.version, tick(before));
    return { before, after: (committed.preview as unknown as ImportPreview).siteSnapshot as StandingOrdersPreview, committed };
  }
  const money = async () => {
    const months = [1, 2, 3, 0].map(monthsBack);
    return { upcoming: await buildUpcoming(userId, 60), totals: await Promise.all(months.map((d) => monthTotals(userId, d.getUTCFullYear(), d.getUTCMonth() + 1))) };
  };
  const ours = (events: Awaited<ReturnType<typeof buildUpcoming>>["events"]) => events.filter((e) => e.kind === "recurring");

  beforeAll(async () => { storage = await mkdtemp(path.join(os.tmpdir(), "mj-standing-orders-")); env.DOCUMENT_STORAGE_DIR = storage; });
  beforeEach(async () => {
    userId = (await prisma.user.create({ data: { name: "__standing_orders_site_test", email: `${crypto.randomUUID()}@example.test` } })).id;
    accountId = (await prisma.bankAccount.create({ data: { userId, bankName: "הבינלאומי", accountName: "עו״ש" } })).id;
    for (const n of [1, 2, 3]) await debit(n);
  });
  afterEach(async () => { await prisma.user.delete({ where: { id: userId } }); });
  afterAll(async () => { env.DOCUMENT_STORAGE_DIR = originalStorage; await rm(storage, { recursive: true, force: true }); await prisma.$disconnect(); });

  // Edge 12.
  it("labels a saved payment as verified and keeps its amount and dates, even when the site shows another amount; the money figures do not move", async () => {
    await statementCommitmentsService.apply(userId, accountId, "all");
    const saved = await prisma.recurringPayment.findFirstOrThrow({ where: { userId, detectedKey: KEY } });
    const before = await money();
    const { after } = await approve([order({ amount: 125, kind: "standing_order" })]);
    expect(after.orders[0].match).toMatchObject({ reason: "matched", detectedKey: KEY, recurringPaymentId: saved.id, canAdd: false });
    const labelled = await prisma.recurringPayment.findUniqueOrThrow({ where: { id: saved.id } });
    expect(labelled).toMatchObject({ amount: saved.amount, nextPaymentDate: saved.nextPaymentDate, detectedThrough: saved.detectedThrough, name: saved.name,
      verifiedSource: "bank_site", debitKind: "standing_order", bankStatus: "active", bankReference: "4321" });
    expect(labelled.verifiedAt).not.toBeNull();
    expect(await money()).toEqual(before);
    expect(await prisma.expense.count({ where: { userId } })).toBe(0);
    expect(await prisma.subscription.count({ where: { userId } })).toBe(0);
    expect(await prisma.loan.count({ where: { userId } })).toBe(0);
    expect(await prisma.bankTransaction.count({ where: { userId } })).toBe(3);
  });

  it("adds a matched debit not saved yet only when she ticks it — at the checking debit's amount, labelled", async () => {
    await approve([order({ amount: 125 })]);
    expect(await prisma.recurringPayment.count({ where: { userId } })).toBe(0);
    const { before } = await approve([order({ amount: 124 })], (p) => p.orders.map((o) => o.key));
    expect(before.orders[0].match).toMatchObject({ reason: "matched", canAdd: true, recurringPaymentId: null });
    const added = await prisma.recurringPayment.findFirstOrThrow({ where: { userId } });
    expect(added).toMatchObject({ detectedKey: KEY, verifiedSource: "bank_site", bankStatus: "active" });
    expect(Number(added.amount)).toBe(120);
  });

  // Edge 13.
  it("an active order with no debit in the checking rows is shown, never saved", async () => {
    const { after, committed } = await approve([order({ payee: "ארנונה עירונית", amount: 400 })], (p) => p.orders.map((o) => o.key));
    expect(after.orders[0].match).toEqual({ detectedKey: null, name: null, lastDebitDate: null, reason: "no_checking_debit", recurringPaymentId: null, canAdd: false });
    expect(committed.status).toBe("review");
    expect(await prisma.recurringPayment.count({ where: { userId } })).toBe(0);
  });

  // Edge 14.
  it("an inactive order hides its future occurrences; a checking debit after that day brings them back", async () => {
    await statementCommitmentsService.apply(userId, accountId, "all");
    expect(ours((await buildUpcoming(userId, 60)).events).length).toBeGreaterThan(0);
    await approve([order({ status: "inactive" })]);
    const marked = await prisma.recurringPayment.findFirstOrThrow({ where: { userId, detectedKey: KEY } });
    expect(marked.bankStatus).toBe("inactive");
    expect(ours((await buildUpcoming(userId, 60)).events)).toEqual([]);

    // As if the page was read a month ago and the payee has charged since.
    await prisma.recurringPayment.update({ where: { id: marked.id }, data: { verifiedAt: new Date(monthsBack(1).getTime() - 5 * 86_400_000) } });
    await statementCommitmentsService.apply(userId, accountId, { accept: [] });
    expect((await prisma.recurringPayment.findUniqueOrThrow({ where: { id: marked.id } })).bankStatus).toBeNull();
    expect(ours((await buildUpcoming(userId, 60)).events).length).toBeGreaterThan(0);
  });

  // Edge 18.
  it("a debit she dismissed is not added back, even ticked", async () => {
    await prisma.dismissedCommitment.create({ data: { userId, key: KEY } });
    const { before } = await approve([order()], (p) => p.orders.map((o) => o.key));
    expect(before.orders[0].match).toMatchObject({ reason: "matched", canAdd: false });
    expect(await prisma.recurringPayment.count({ where: { userId } })).toBe(0);
  });

  it("refuses the kind from an upload: only the server's own sync makes these", async () => {
    const uploaded = await importSessions.create(userId, "orders.json", standingOrdersFile([order()]), { kind: "standing_orders", accountId });
    expect(uploaded.status).toBe("failed");
    await expect(importSessions.commit(userId, uploaded.id, uploaded.version, [])).rejects.toThrow();
  });
});
