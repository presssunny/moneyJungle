import { prisma } from "../../config/database";
import type { Prisma } from "../../../generated/prisma/client";

/** The only card rows that count as spending: confirmed imports, never internal financing (CLAUDE.md §5). */
export const spendingCredit = {
  transactionType: { not: "financing" },
  creditImport: { status: "confirmed" },
} satisfies Prisma.CreditTransactionWhereInput;

/** Spending credit in a month by its attribution date (`billingDate` = the purchase date), never by chargeDate. */
export function spendingCreditInMonth(userId: number, start: Date, end: Date) {
  return { userId, billingDate: { gte: start, lt: end }, ...spendingCredit } satisfies Prisma.CreditTransactionWhereInput;
}

export const dashboardRepository = {
  sumIncomes(userId: number, start: Date, end: Date) {
    return prisma.income.aggregate({
      where: { userId, incomeDate: { gte: start, lt: end } },
      _sum: { amount: true },
    });
  },

  sumExpenses(userId: number, start: Date, end: Date) {
    return prisma.expense.aggregate({
      where: { userId, expenseDate: { gte: start, lt: end } },
      _sum: { amount: true },
    });
  },

  sumConfirmedCredit(userId: number, start: Date, end: Date) {
    return prisma.creditTransaction.aggregate({
      where: spendingCreditInMonth(userId, start, end),
      _sum: { amount: true },
    });
  },

  expensesByCategory(userId: number, start: Date, end: Date) {
    return prisma.expense.groupBy({
      by: ["categoryId"],
      where: { userId, expenseDate: { gte: start, lt: end } },
      _sum: { amount: true },
    });
  },

  creditByCategory(userId: number, start: Date, end: Date) {
    return prisma.creditTransaction.groupBy({
      by: ["categoryId"],
      where: spendingCreditInMonth(userId, start, end),
      _sum: { amount: true },
    });
  },

  /**
   * Imported bank rows still awaiting a decision. After a resolve pass this is
   * normally empty — every row gets a meaning — so anything here is a genuine
   * dead end that the dashboard must say out loud.
   */
  pendingBankRows(userId: number) {
    return prisma.bankTransaction.groupBy({
      by: ["lineKind"],
      where: { userId, reconcileStatus: "pending" },
      _sum: { amount: true },
      _count: { _all: true },
    });
  },

  /**
   * Bank rows for one month, grouped by what they turned out to MEAN. This is how
   * the dashboard accounts for money that is real but is not spending — principal,
   * a settled card bill, an internal transfer. Report only income and expenses and
   * the statement looks like it is missing money.
   */
  bankRowsByResolution(userId: number, start: Date, end: Date) {
    return prisma.bankTransaction.groupBy({
      by: ["resolution"],
      where: { userId, transactionDate: { gte: start, lt: end } },
      _sum: { amount: true },
      _count: { _all: true },
    });
  },

  categories(userId: number) {
    return prisma.category.findMany({
      where: { OR: [{ userId }, { userId: null }] },
    });
  },

  budgets(userId: number, year: number, month: number) {
    return prisma.budget.findMany({
      where: { userId, year, month },
      include: { category: true },
    });
  },

  recentExpenses(userId: number, take = 5) {
    return prisma.expense.findMany({
      where: { userId },
      orderBy: [{ expenseDate: "desc" }, { id: "desc" }],
      include: { category: true },
      take,
    });
  },

  recentIncomes(userId: number, take = 5) {
    return prisma.income.findMany({
      where: { userId },
      orderBy: [{ incomeDate: "desc" }, { id: "desc" }],
      take,
    });
  },

  recentCredit(userId: number, take = 5) {
    return prisma.creditTransaction.findMany({
      where: { userId, ...spendingCredit },
      orderBy: [{ billingDate: "desc" }, { id: "desc" }],
      include: { category: true },
      take,
    });
  },

  recentAlerts(userId: number, take = 5) {
    return prisma.alert.findMany({
      where: { userId, withdrawnAt: null },
      orderBy: { createdAt: "desc" },
      take,
    });
  },
};
