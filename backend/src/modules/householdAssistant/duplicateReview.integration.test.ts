import crypto from "node:crypto";
import request from "supertest";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import app from "../../app";
import { prisma } from "../../config/database";
import { businessDate, nextDate } from "../../utils/date.utils";
import type { DuplicateCandidate, DuplicateDecision, DuplicateReviewInput } from "../../types/householdAssistant.types";
import { monthTotals } from "../dashboard/dashboard.service";
import { csrfForSession, sessionCookieName } from "../gate/sessionCookie";
import { expensesService } from "../expenses/expenses.service";
import { scanForAlerts } from "../alerts/alertsScanner.service";
import { financialStatus } from "../journey/coverage.service";
import { decideDuplicate, duplicateDetail, duplicateHistory, scanDuplicates, undoDuplicate } from "./duplicateReview.service";

let userId: number;
let otherId: number;
let token: string;
const today = businessDate();
const [year, month] = today.split("-").map(Number);
const base = "/api/household-assistant";
const showing = () => prisma.alert.count({ where: { userId, type: "duplicate_transaction", withdrawnAt: null } });
const headers = () => ({ Cookie: `${sessionCookieName}=${token}`, "X-CSRF-Token": csrfForSession(token), Origin: "http://localhost:5173" });
beforeEach(async () => {
  userId = (await prisma.user.create({ data: { name: "__duplicate_review_test", email: `${crypto.randomUUID()}@example.test` } })).id;
  otherId = (await prisma.user.create({ data: { name: "__duplicate_review_other" } })).id;
  token = crypto.randomBytes(32).toString("hex");
  await prisma.gateSession.create({ data: { userId, tokenHash: crypto.createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 600000) } });
});
afterEach(async () => { vi.restoreAllMocks(); await prisma.user.deleteMany({ where: { id: { in: [userId, otherId] } } }); });
afterAll(async () => { await prisma.$disconnect(); });
async function expenses(count = 2, owner = userId) {
  await prisma.expense.createMany({ data: Array.from({ length: count }, () => ({ userId: owner, businessName: "רישום לבדיקה", description: "פרטים מקוריים", amount: 120.50, expenseDate: new Date(today), isRecurring: true })) });
  return (await scanDuplicates(owner)).candidates[0];
}
function input(c: DuplicateCandidate, decision: DuplicateDecision = "separate"): DuplicateReviewInput {
  return { requestId: crypto.randomUUID(), candidateId: c.id, version: c.version, decision, confirmed: true,
    ...(decision === "remove_manual" ? { removedKey: c.records.find(r => r.kind !== "credit")!.key, keptKey: c.records.find(r => r.key !== c.records.find(row => row.kind !== "credit")!.key)!.key } : {}) };
}
async function credit(count = 2) {
  const card = await prisma.creditCard.create({ data: { userId, name: "כרטיס המשפחה", issuer: "test", lastFour: "1234" } });
  const imported = await prisma.creditImport.create({ data: { userId, fileName: "statement.xlsx", importMonth: month, importYear: year, status: "confirmed" } });
  await prisma.creditTransaction.createMany({ data: Array.from({ length: count }, () => ({ userId, cardId: card.id, creditImportId: imported.id, businessName: "רישום לבדיקה", amount: 120.50, transactionDate: new Date(today), billingDate: new Date(today) })) });
  return { card, imported };
}

describe("persisted duplicate review", () => {
  it("saves separate transactions, suppresses the exact evidence and legacy alerts, and undo reopens both", async () => {
    const c = await expenses();
    const before = await monthTotals(userId, year, month);
    await scanForAlerts(userId);
    expect(await showing()).toBe(1);
    const { review } = await decideDuplicate(userId, input(c));
    expect((await scanDuplicates(userId)).candidateCount).toBe(0);
    expect((await duplicateHistory(userId)).items[0]).toMatchObject({ id: review.id, status: "active", canUndo: true });
    expect(await monthTotals(userId, year, month)).toEqual(before);
    await scanForAlerts(userId);
    expect(await showing()).toBe(0);
    // Withdrawn from view, not destroyed: what the household was once told survives.
    expect(await prisma.alert.count({ where: { userId, type: "duplicate_transaction" } })).toBe(1);
    await undoDuplicate(userId, review.id, review.version);
    expect((await scanDuplicates(userId)).candidateCount).toBe(1);
    expect((await duplicateHistory(userId)).items[0].status).toBe("undone");
    await scanForAlerts(userId);
    expect(await showing()).toBe(1);
  });
  it("identifies an alert by its evidence, so a resolved group cannot leave a stale amount on screen", async () => {
    await expenses();
    await prisma.expense.createMany({ data: [1, 2].map(() => ({ userId, businessName: "רישום לבדיקה", amount: 980, expenseDate: new Date(today) })) });
    await scanForAlerts(userId);
    expect(await showing()).toBe(2);
    const cheap = (await scanDuplicates(userId)).candidates.find(c => c.records[0].amount === 120.5)!;
    await decideDuplicate(userId, input(cheap));
    await scanForAlerts(userId);
    // Same merchant name, different evidence: the resolved group goes, the open one stays intact.
    const live = await prisma.alert.findMany({ where: { userId, type: "duplicate_transaction", withdrawnAt: null } });
    expect(live).toHaveLength(1);
    expect(live[0].message).toContain("980");
    expect(live[0].message).not.toContain("120.5");
  });
  it("never raises an alert the review screen cannot resolve", async () => {
    // Recurring rows and bank-linked rows are outside the review scan by design,
    // so they must not raise an alert that links to a screen with nothing on it.
    await prisma.expense.createMany({ data: [1, 2].map(() => ({ userId, businessName: "מנוי חודשי", amount: 75, expenseDate: new Date(today), source: "recurring" as const })) });
    const linked = await expenses();
    const account = await prisma.bankAccount.create({ data: { userId, bankName: "test", accountName: "test" } });
    await prisma.bankTransaction.create({ data: { userId, bankAccountId: account.id, amount: 120.5, type: "withdrawal", transactionDate: new Date(today), linkedExpenseId: Number(linked.records[0].key.split(":")[1]) } });
    await scanForAlerts(userId);
    expect(await showing()).toBe(0);
    expect((await scanDuplicates(userId)).candidateCount).toBe(0);
  });
  it("refuses to remove an income that a bank row still points at through a lost link", async () => {
    await prisma.income.createMany({ data: [1, 2].map(() => ({ userId, amount: 500, description: "משכורת", type: "salary", incomeDate: new Date(today) })) });
    const account = await prisma.bankAccount.create({ data: { userId, bankName: "test", accountName: "test" } });
    await prisma.bankTransaction.create({ data: { userId, bankAccountId: account.id, amount: 500, type: "deposit", transactionDate: new Date(today), resolution: "income", linkedIncomeId: null } });
    const c = (await scanDuplicates(userId)).candidates[0];
    await expect(decideDuplicate(userId, input(c, "remove_manual"))).rejects.toMatchObject({ statusCode: 409 });
    expect(await prisma.income.count({ where: { userId } })).toBe(2);
    expect(await prisma.duplicateReview.count({ where: { userId } })).toBe(0);
  });
  it("removes exactly the selected manual row once, invalidates coverage, and restores all original fields", async () => {
    const c = await expenses();
    const payload = input(c, "remove_manual");
    const id = Number(payload.removedKey!.split(":")[1]);
    const original = await prisma.expense.findUniqueOrThrow({ where: { id } });
    const coverage = await financialStatus(userId);
    const before = await monthTotals(userId, year, month);
    const result = await decideDuplicate(userId, payload);
    expect(result.financialDomain).toBe("expenses");
    expect(await prisma.expense.count({ where: { userId } })).toBe(1);
    expect((await monthTotals(userId, year, month)).expenseTotal).toBe(before.expenseTotal - 120.5);
    expect((await financialStatus(userId)).dataVersion).not.toBe(coverage.dataVersion);
    expect((await decideDuplicate(userId, payload)).review.id).toBe(result.review.id);
    expect((await prisma.financialProfile.findUniqueOrThrow({ where: { userId } })).revision).toBe(1);
    expect(await prisma.duplicateReview.count({ where: { userId } })).toBe(1);
    const undone = await undoDuplicate(userId, result.review.id, result.review.version);
    expect(undone.financialDomain).toBe("expenses");
    const restored = await prisma.expense.findUniqueOrThrow({ where: { id } });
    expect({ ...restored, updatedAt: original.updatedAt }).toEqual(original);
    expect(await monthTotals(userId, year, month)).toEqual(before);
    await undoDuplicate(userId, result.review.id, result.review.version);
    expect(await prisma.expense.count({ where: { userId } })).toBe(2);
    expect((await prisma.financialProfile.findUniqueOrThrow({ where: { userId } })).revision).toBe(2);
  });
  it("restores income with its identity, type, recurrence and original month", async () => {
    await prisma.income.createMany({ data: [1, 2].map(() => ({ userId, amount: 500, description: "משכורת", type: "salary", isRecurring: true, incomeDate: new Date(today) })) });
    const c = (await scanDuplicates(userId)).candidates[0];
    const before = await monthTotals(userId, year, month);
    const result = await decideDuplicate(userId, input(c, "remove_manual"));
    expect(result.financialDomain).toBe("incomes");
    expect((await monthTotals(userId, year, month)).incomeTotal).toBe(500);
    await undoDuplicate(userId, result.review.id, result.review.version);
    expect(await monthTotals(userId, year, month)).toEqual(before);
    expect(await prisma.income.count({ where: { userId, type: "salary", isRecurring: true } })).toBe(2);
  });
  it("keeps imported charges immutable while correcting a manual/card overlap", async () => {
    await expenses(1); await credit(1);
    const c = (await scanDuplicates(userId)).candidates[0];
    expect(c.reason).toBe("manual_and_card");
    const rows = await prisma.creditTransaction.findMany({ where: { userId } });
    const result = await decideDuplicate(userId, input(c, "remove_manual"));
    expect(await prisma.creditTransaction.findMany({ where: { userId } })).toEqual(rows);
    expect((await monthTotals(userId, year, month)).expenseTotal).toBe(120.5);
    await undoDuplicate(userId, result.review.id, result.review.version);
    expect((await monthTotals(userId, year, month)).expenseTotal).toBe(241);
  });
  it("tracks issuer follow-up without hiding money and can reopen then record separate charges", async () => {
    await credit();
    const c = (await scanDuplicates(userId)).candidates[0];
    const before = await monthTotals(userId, year, month);
    await expect(decideDuplicate(userId, { ...input(c), decision: "remove_manual", removedKey: c.records[0].key, keptKey: c.records[1].key })).rejects.toMatchObject({ statusCode: 400 });
    const { review } = await decideDuplicate(userId, input(c, "source_charge"));
    expect(await monthTotals(userId, year, month)).toEqual(before);
    expect(await scanDuplicates(userId)).toMatchObject({ candidateCount: 0, followUpCount: 1 });
    expect((await duplicateHistory(userId, undefined, true)).items).toHaveLength(1);
    await undoDuplicate(userId, review.id, review.version);
    await decideDuplicate(userId, input(c));
    expect((await duplicateHistory(userId, undefined, true)).items).toHaveLength(0);
  });
  it("revalidates metadata edits and rejects stale confirmation without deleting anything", async () => {
    const c = await expenses(); const payload = input(c, "remove_manual");
    await prisma.expense.update({ where: { id: Number(c.records[0].key.split(":")[1]) }, data: { description: "edited" } });
    await expect(decideDuplicate(userId, payload)).rejects.toMatchObject({ statusCode: 409 });
    expect(await prisma.expense.count({ where: { userId } })).toBe(2);
    expect(await prisma.duplicateReview.count({ where: { userId } })).toBe(0);
  });
  it("reopens saved decisions after source edits and new group members", async () => {
    let c = await expenses(); await decideDuplicate(userId, input(c));
    await prisma.expense.update({ where: { id: Number(c.records[0].key.split(":")[1]) }, data: { description: "changed" } });
    expect((await scanDuplicates(userId)).candidates[0].reopened).toBe(true);
    expect((await duplicateHistory(userId)).items[0].status).toBe("stale");
    c = (await scanDuplicates(userId)).candidates[0]; await decideDuplicate(userId, input(c));
    await expenses(1);
    expect((await scanDuplicates(userId)).candidates[0]).toMatchObject({ recordCount: 3, reopened: true });
    expect((await duplicateHistory(userId)).items.every(r => r.status === "stale")).toBe(true);
    await scanForAlerts(userId);
    expect(await prisma.alert.count({ where: { userId, type: "duplicate_transaction" } })).toBe(1);
  });
  it("blocks undo when the retained source changes and never restores into changed evidence", async () => {
    const c = await expenses(); const payload = input(c, "remove_manual");
    const { review } = await decideDuplicate(userId, payload);
    await prisma.expense.update({ where: { id: Number(payload.keptKey!.split(":")[1]) }, data: { amount: 121 } });
    await expect(undoDuplicate(userId, review.id, review.version)).rejects.toMatchObject({ statusCode: 409 });
    const refreshed = (await duplicateHistory(userId)).items[0];
    expect(refreshed).toMatchObject({ status: "stale", canUndo: false });
    await expect(undoDuplicate(userId, review.id, refreshed.version)).rejects.toMatchObject({ statusCode: 409 });
    expect(await prisma.expense.count({ where: { userId } })).toBe(1);
  });
  it("invalidates approvals when bank links or imported source identity change", async () => {
    const c = await expenses(); await decideDuplicate(userId, input(c));
    const account = await prisma.bankAccount.create({ data: { userId, bankName: "test", accountName: "test" } });
    await prisma.bankTransaction.create({ data: { userId, bankAccountId: account.id, amount: 120.5, type: "withdrawal", transactionDate: new Date(today), linkedExpenseId: Number(c.records[0].key.split(":")[1]) } });
    expect((await duplicateHistory(userId)).items[0].status).toBe("stale");
    expect((await scanDuplicates(userId)).candidateCount).toBe(0);
    const { imported } = await credit(); const charge = (await scanDuplicates(userId)).candidates.find(r => r.records.every(row => row.kind === "credit"))!;
    const { review } = await decideDuplicate(userId, input(charge));
    await prisma.creditImport.update({ where: { id: imported.id }, data: { fileName: "changed.xlsx" } });
    expect((await duplicateHistory(userId)).items.find(r => r.id === review.id)?.status).toBe("stale");
    expect((await scanDuplicates(userId)).candidates.some(r => r.id === charge.id && r.reopened)).toBe(true);
  });
  it("rolls deletion back if the workflow fails before its audit record commits", async () => {
    const c = await expenses(); const remove = expensesService.remove.bind(expensesService);
    vi.spyOn(expensesService, "remove").mockImplementation(async (owner, id) => { await remove(owner, id); throw new Error("simulated audit failure"); });
    await expect(decideDuplicate(userId, input(c, "remove_manual"))).rejects.toThrow("simulated audit failure");
    expect(await prisma.expense.count({ where: { userId } })).toBe(2);
    expect(await prisma.duplicateReview.count({ where: { userId } })).toBe(0);
    expect(await prisma.financialProfile.findUnique({ where: { userId } })).toBeNull();
  });
  it("serializes concurrent corrections and rejects request-ID reuse for a different decision", async () => {
    const c = await expenses(); const payload = input(c, "remove_manual");
    const same = await Promise.all([decideDuplicate(userId, payload), decideDuplicate(userId, payload)]);
    expect(same[0].review.id).toBe(same[1].review.id);
    await expect(decideDuplicate(userId, { ...payload, decision: "separate" })).rejects.toMatchObject({ statusCode: 409 });
    expect(await prisma.expense.count({ where: { userId } })).toBe(1);
    await undoDuplicate(userId, same[0].review.id, same[0].review.version);
    const fresh = (await scanDuplicates(userId)).candidates[0];
    const competing = await Promise.allSettled([decideDuplicate(userId, input(fresh, "remove_manual")), decideDuplicate(userId, input(fresh, "remove_manual"))]);
    expect(competing.filter(r => r.status === "fulfilled")).toHaveLength(1);
  });
  it("shows full groups before approval, including records beyond the list preview", async () => {
    const preview = await expenses(24);
    expect(preview.records).toHaveLength(20);
    const full = await duplicateDetail(userId, preview.id);
    expect(full.records).toHaveLength(24);
    const payload = { ...input(full, "remove_manual"), removedKey: full.records[23].key, keptKey: full.records[22].key };
    await decideDuplicate(userId, payload);
    const history = (await duplicateHistory(userId)).items[0];
    expect(history.recordCount).toBe(24);
    expect(history.records.map(r => r.key)).toContain(payload.removedKey);
    expect(history.records.map(r => r.key)).toContain(payload.keptKey);
  });
  it("paginates immutable history and keeps out-of-window decisions available", async () => {
    const c = await expenses();
    for (let i = 0; i < 22; i++) { const { review } = await decideDuplicate(userId, input(c)); await undoDuplicate(userId, review.id, review.version); }
    const first = await duplicateHistory(userId); const second = await duplicateHistory(userId, first.nextCursor!);
    expect(first.items).toHaveLength(20); expect(second.items).toHaveLength(2); expect(second.nextCursor).toBeNull();
    expect(new Set([...first.items, ...second.items].map(r => r.id)).size).toBe(22);
    await prisma.expense.updateMany({ where: { userId }, data: { expenseDate: new Date(nextDate(today, -100)) } });
    expect((await duplicateHistory(userId)).items).toHaveLength(20);
  });
  it("requires authentication, CSRF, confirmation and valid ownership on every API mutation", async () => {
    const c = await expenses(); const foreign = await expenses(2, otherId); const payload = input(c);
    expect((await request(app).post(`${base}/duplicate-reviews`).set("Origin", "http://localhost:5173").send(payload)).status).toBe(401);
    expect((await request(app).post(`${base}/duplicate-reviews`).set("Cookie", `${sessionCookieName}=${token}`).send(payload)).status).toBe(403);
    for (const bad of [{ ...payload, confirmed: false }, { ...payload, userId: otherId }, { ...payload, version: "invalid" }, { ...payload, keptKey: c.records[0].key }]) {
      expect((await request(app).post(`${base}/duplicate-reviews`).set(headers()).send(bad)).status).toBe(400);
    }
    expect((await request(app).get(`${base}/duplicates/${foreign.id}`).set(headers())).status).toBe(409);
    expect((await request(app).post(`${base}/duplicate-reviews`).set(headers()).send(input(foreign))).status).toBe(409);
    const result = await decideDuplicate(otherId, input(foreign));
    expect((await request(app).post(`${base}/duplicate-reviews/${result.review.id}/undo`).set(headers()).send({ version: result.review.version, confirmed: true })).status).toBe(404);
    expect((await request(app).get(`${base}/duplicate-reviews?cursor=${result.review.id}`).set(headers())).status).toBe(404);
    const saved = await request(app).post(`${base}/duplicate-reviews`).set(headers()).send(payload);
    expect(saved.status).toBe(200);
    const history = await request(app).get(`${base}/duplicate-reviews`).set(headers());
    expect(history.headers["cache-control"]).toBe("no-store");
    expect(history.body.items.map((r: { id: string }) => r.id)).toEqual([saved.body.review.id]);
  });
  it("blocks restore if the original category is gone without partially recreating the expense", async () => {
    const c = await expenses();
    const category = await prisma.category.create({ data: { userId, name: "קטגוריה מקורית", type: "expense" } });
    await prisma.expense.update({ where: { id: Number(c.records[0].key.split(":")[1]) }, data: { categoryId: category.id } });
    const fresh = (await scanDuplicates(userId)).candidates[0];
    const { review } = await decideDuplicate(userId, input(fresh, "remove_manual"));
    await prisma.category.delete({ where: { id: category.id } });
    const history = (await duplicateHistory(userId)).items[0];
    expect(history.canUndo).toBe(false); expect(history.undoBlockedReason).toContain("הקטגוריה");
    await expect(undoDuplicate(userId, review.id, history.version)).rejects.toMatchObject({ statusCode: 409 });
    expect(await prisma.expense.count({ where: { userId } })).toBe(1);
  });
});
