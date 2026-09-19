import crypto from "node:crypto";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { prisma } from "../../config/database";
import { monthTotals } from "./dashboard.service";
import { financialStatus } from "../journey/coverage.service";

let userId: number;
beforeEach(async () => { userId = (await prisma.user.create({ data: { name: "__dashboard_test", email: `${crypto.randomUUID()}@example.test` } })).id; });
afterEach(async () => { await prisma.user.delete({ where: { id: userId } }); });

describe("dashboard.repository is the single source of truth for monthly totals (test-gap closure)", () => {
  it("an own-account internal transfer is never counted as an expense", async () => {
    const account = await prisma.bankAccount.create({ data: { userId, bankName: "test", accountName: "A" } });
    await prisma.bankTransaction.create({ data: { userId, bankAccountId: account.id, transactionDate: new Date("2026-09-10"), amount: 500, type: "withdrawal", resolution: "internal_transfer" } });
    const totals = await monthTotals(userId, 2026, 9);
    expect(totals.expenseTotal).toBe(0);
  });

  it("a credit-card settlement bank row is not double-counted alongside the confirmed purchases it settles", async () => {
    const account = await prisma.bankAccount.create({ data: { userId, bankName: "test", accountName: "A" } });
    const card = await prisma.creditCard.create({ data: { userId, name: "card", issuer: "test", lastFour: "1234" } });
    const creditImport = await prisma.creditImport.create({ data: { userId, fileName: "c.xlsx", fileHash: crypto.randomUUID(), status: "confirmed", importMonth: 9, importYear: 2026 } });
    await prisma.creditTransaction.create({ data: { userId, creditImportId: creditImport.id, cardId: card.id, transactionDate: new Date("2026-09-05"), billingDate: new Date("2026-09-05"), businessName: "Groceries", amount: 300 } });
    // The bank row that settles the card bill -- the money already counted above as the purchase.
    await prisma.bankTransaction.create({ data: { userId, bankAccountId: account.id, transactionDate: new Date("2026-09-10"), amount: 300, type: "withdrawal", resolution: "credit_card_settled" } });
    const totals = await monthTotals(userId, 2026, 9);
    expect(totals.expenseTotal).toBe(300);
    expect(totals.creditTotal).toBe(300);
  });

  it("a cash-only user (no bank accounts, no credit cards) still gets correct monthly totals from manual expenses, with allowance explicitly unavailable rather than a guessed number", async () => {
    await prisma.expense.create({ data: { userId, businessName: "Manual", amount: 42, expenseDate: new Date("2026-09-10") } });
    await prisma.income.create({ data: { userId, type: "salary", amount: 1000, incomeDate: new Date("2026-09-01") } });
    const totals = await monthTotals(userId, 2026, 9);
    expect(totals.expenseTotal).toBe(42);
    expect(totals.incomeTotal).toBe(1000);
    const status = await financialStatus(userId);
    expect(status.hasActivity).toBe(true);
    expect(status.allowance.state).toBe("unavailable");
    expect(status.allowance.amount).toBeNull();
    expect(status.blockers.some(b => b.includes("אין יתרת בנק"))).toBe(true);
  });
});
