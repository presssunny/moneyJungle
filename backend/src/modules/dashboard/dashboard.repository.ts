import { prisma } from "../../config/database";

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
    // Attribute by billingDate — the month the purchase was made (see schema)
    return prisma.creditTransaction.aggregate({
      where: {
        userId,
        billingDate: { gte: start, lt: end },
        transactionType: { not: "financing" },
        creditImport: { status: "confirmed" },
      },
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
      where: {
        userId,
        billingDate: { gte: start, lt: end },
        transactionType: { not: "financing" },
        creditImport: { status: "confirmed" },
      },
      _sum: { amount: true },
    });
  },

  /**
   * Imported bank rows still awaiting a decision. These are deliberately absent
   * from every money figure (loan principal, unnamed large credits, internal
   * transfers), so the dashboard has to say they exist — otherwise the totals
   * look complete while real money sits unaccounted for.
   */
  pendingBankRows(userId: number) {
    return prisma.bankTransaction.groupBy({
      by: ["lineKind"],
      where: { userId, reconcileStatus: "pending" },
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
      where: { userId, transactionType: { not: "financing" }, creditImport: { status: "confirmed" } },
      orderBy: [{ billingDate: "desc" }, { id: "desc" }],
      include: { category: true },
      take,
    });
  },

  recentAlerts(userId: number, take = 5) {
    return prisma.alert.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take,
    });
  },
};
