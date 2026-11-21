import crypto from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../config/database";
import { businessDate } from "../../utils/date.utils";
import { crmService } from "../crm/crm.service";
import { financialStatus } from "../journey/coverage.service";
import { accountBalanceService } from "./accountBalance.service";
import { createBankAccountSchema } from "./bank.validation";
import { bankService } from "./bank.service";

let userId: number;

beforeEach(async () => {
  userId = (await prisma.user.create({ data: { name: "__account_balance_test", email: `${crypto.randomUUID()}@example.test` } })).id;
});
afterEach(async () => { await prisma.user.delete({ where: { id: userId } }); });
afterAll(async () => { await prisma.$disconnect(); });

async function accountWithDeposit(initialBalance: number | null) {
  const account = await prisma.bankAccount.create({ data: { userId, bankName: "הבינלאומי", accountName: "עו״ש", initialBalance } });
  await prisma.bankTransaction.create({ data: { userId, bankAccountId: account.id, transactionDate: new Date("2026-09-01"), description: "משכורת", amount: 7000, type: "deposit" } });
  return account;
}

describe("a bank balance nobody stated", () => {
  it("an account opened without a balance is unknown, not 0", async () => {
    expect(createBankAccountSchema.parse({ bankName: "הבינלאומי", accountName: "עו״ש" })).not.toHaveProperty("initialBalance");
    const created = await bankService.createAccount(userId, { bankName: "הבינלאומי", accountName: "עו״ש" });
    expect(created.initialBalance).toBeNull();
    expect(created.currentBalance).toBeNull();
  });

  it("with no opening balance and nothing to measure from, the balance is unknown — and stays unknown when stored", async () => {
    const account = await accountWithDeposit(null);
    const derived = await accountBalanceService.recompute(userId, account.id);
    expect(derived).toMatchObject({ balance: null, basis: "unknown", anchor: null });
    expect(derived.explanation).toMatch(/לא ידועה/);
    expect((await prisma.bankAccount.findUniqueOrThrow({ where: { id: account.id } })).currentBalance).toBeNull();
  });

  it("a stated opening balance, or a balance she stated, still gives a number", async () => {
    const opened = await accountWithDeposit(1000);
    expect((await accountBalanceService.derive(userId, opened.id)).balance).toBe(8000);
    const stated = await accountWithDeposit(null);
    await prisma.bankAccount.update({ where: { id: stated.id }, data: { anchorBalance: 2500, anchorDate: new Date("2026-09-15") } });
    expect((await accountBalanceService.derive(userId, stated.id)).balance).toBe(2500);
  });

  it("cash for planning is unavailable, with the reason, while one balance is unknown", async () => {
    await accountWithDeposit(null);
    const status = await financialStatus(userId);
    expect(status.allowance.cash).toBeNull();
    expect(status.allowance.amount).toBeNull();
    expect(status.blockers.join(" ")).toMatch(/יתרת הפתיחה של עו״ש לא ידועה/);
  });

  it("the CRM view shows an unknown balance as missing and counts it, never as 0", async () => {
    await accountWithDeposit(null);
    await prisma.bankAccount.create({ data: { userId, bankName: "לאומי", accountName: "חיסכון", initialBalance: 300 } });
    await accountBalanceService.recomputeAll(userId);
    const detail = await crmService.getCustomerDetail(userId);
    expect(detail.bank.accounts.map((a) => a.currentBalance).sort()).toEqual([300, null]);
    expect(detail.bank.totalBalance).toBeNull();
    expect(detail.bank.unknownBalanceCount).toBe(1);
    await prisma.loan.create({ data: { userId, loanName: "הלוואה", loanType: "bank", monthlyPayment: 900, startDate: new Date("2026-01-01"), currentBalance: null, scheduleSource: "statement" } });
    const listed = (await crmService.listCustomers()).find((c) => c.id === userId);
    expect(listed?.bankBalance).toBeNull();
    expect(listed?.activeLoanBalance).toBeNull();
    const loan = (await crmService.getCustomerDetail(userId)).loans[0];
    expect(loan).toMatchObject({ currentBalance: null, earlyRepaymentFee: null, closureCost: null });
  });
});

describe("cash for planning with several accounts", () => {
  it("is unknown — not 0 — until she picks the account the spending comes from", async () => {
    await prisma.bankAccount.create({ data: { userId, bankName: "א", accountName: "עו״ש", initialBalance: 1000 } });
    await prisma.bankAccount.create({ data: { userId, bankName: "ב", accountName: "משני", initialBalance: 500 } });
    const status = await financialStatus(userId);
    expect(status.allowance.cashInPlan).toBeNull();
    expect(status.blockers.join(" ")).toMatch(/יש לבחור את החשבון שממנו יוצאות ההוצאות השוטפות/);
  });
});

describe("the balance she types when opening an account, and the accounts' total", () => {
  it("a typed current balance is that day's stated balance, not an opening balance", async () => {
    const created = await bankService.createAccount(userId, createBankAccountSchema.parse({ bankName: "הבינלאומי", accountName: "עו״ש", currentBalance: 2500 }));
    expect(created.initialBalance).toBeNull();
    expect(Number(created.anchorBalance)).toBe(2500);
    expect(created.anchorDate?.toISOString().slice(0, 10)).toBe(businessDate());
    expect((await accountBalanceService.derive(userId, created.id)).balance).toBe(2500);
  });

  it("the total is the server's, and unavailable while one balance is unknown", async () => {
    await prisma.bankAccount.create({ data: { userId, bankName: "לאומי", accountName: "חיסכון", initialBalance: 300 } });
    expect((await bankService.listAccounts(userId)).totals).toEqual({ totalBalance: 300, unknownBalanceCount: 0 });
    await accountWithDeposit(null);
    const { accounts, totals } = await bankService.listAccounts(userId);
    expect(accounts).toHaveLength(2);
    expect(totals).toEqual({ totalBalance: null, unknownBalanceCount: 1 });
  });
});
