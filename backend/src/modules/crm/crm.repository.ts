import { prisma } from "../../config/database";

/**
 * Scalar fields safe to hand back to the CRM client — `passwordHash` is
 * deliberately never in this list. Used with `select` (never bare
 * `include`, which would return every scalar column, `passwordHash`
 * included) everywhere the CRM reads a User row.
 */
const SAFE_USER_FIELDS = {
  id: true,
  name: true,
  email: true,
  role: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} as const;

/**
 * Access for the CRM. List/detail queries take an explicit `userId` chosen by
 * whoever is operating the CRM screen — unlike the rest of the app, which
 * always resolves data through the authenticated session's own userId (see
 * gateAuth.middleware.ts). That is what lets ADMIN/VIEWER see any customer's
 * data, not just their own. Mutating functions (createUser/updateUser) are
 * only ever called from routes already gated by `requireRole("ADMIN")`.
 */
export const crmRepository = {
  /** Every user row, with the counts a list screen needs to triage at a glance. */
  listUsers() {
    return prisma.user.findMany({
      orderBy: { id: "asc" },
      select: {
        ...SAFE_USER_FIELDS,
        _count: {
          select: {
            expenses: true,
            incomes: true,
            loans: true,
            bankAccounts: true,
            subscriptions: true,
            recurringPayments: true,
            documents: true,
            savingsGoals: true,
            budgets: true,
            creditImports: true,
            alerts: true,
            reminders: true,
            familyMembers: true,
          },
        },
      },
    });
  },

  findByEmail(email: string) {
    return prisma.user.findUnique({ where: { email } });
  },

  createUser(data: {
    name: string;
    email: string;
    passwordHash: string;
    role: "ADMIN" | "USER" | "VIEWER";
    status: "active" | "inactive";
  }) {
    return prisma.user.create({ data, select: SAFE_USER_FIELDS });
  },

  updateUser(
    id: number,
    data: Partial<{
      name: string;
      email: string;
      passwordHash: string;
      role: "ADMIN" | "USER" | "VIEWER";
      status: "active" | "inactive";
    }>
  ) {
    return prisma.user.update({ where: { id }, data, select: SAFE_USER_FIELDS });
  },

  sumIncomeByUser() {
    return prisma.income.groupBy({ by: ["userId"], _sum: { amount: true } });
  },

  sumExpenseByUser() {
    return prisma.expense.groupBy({ by: ["userId"], _sum: { amount: true } });
  },

  sumActiveLoanBalanceByUser() {
    return prisma.loan.groupBy({
      by: ["userId"],
      where: { status: "active" },
      _sum: { currentBalance: true },
    });
  },

  sumBankBalanceByUser() {
    return prisma.bankAccount.groupBy({ by: ["userId"], _sum: { currentBalance: true } });
  },

  /** Most recent touch per user across the tables that matter for "last activity". */
  lastActivityByUser() {
    return Promise.all([
      prisma.income.groupBy({ by: ["userId"], _max: { updatedAt: true } }),
      prisma.expense.groupBy({ by: ["userId"], _max: { updatedAt: true } }),
      prisma.loan.groupBy({ by: ["userId"], _max: { updatedAt: true } }),
      prisma.bankTransaction.groupBy({ by: ["userId"], _max: { updatedAt: true } }),
    ]);
  },

  findUserById(id: number) {
    return prisma.user.findUnique({ where: { id }, select: SAFE_USER_FIELDS });
  },

  settings(userId: number) {
    return prisma.settings.findUnique({ where: { userId } });
  },

  familyMembers(userId: number) {
    return prisma.familyMember.findMany({ where: { userId }, orderBy: { id: "asc" } });
  },

  incomes(userId: number) {
    return prisma.income.findMany({ where: { userId }, orderBy: { incomeDate: "desc" } });
  },

  expenses(userId: number) {
    return prisma.expense.findMany({
      where: { userId },
      orderBy: { expenseDate: "desc" },
      include: { category: true, paymentMethod: true },
    });
  },

  budgets(userId: number) {
    return prisma.budget.findMany({
      where: { userId },
      orderBy: [{ year: "desc" }, { month: "desc" }],
      include: { category: true },
    });
  },

  loans(userId: number) {
    return prisma.loan.findMany({
      where: { userId },
      orderBy: { startDate: "desc" },
      include: { _count: { select: { schedule: true } } },
    });
  },

  bankAccounts(userId: number) {
    return prisma.bankAccount.findMany({
      where: { userId },
      orderBy: { id: "asc" },
      include: { _count: { select: { transactions: true, statements: true } } },
    });
  },

  recentBankTransactions(userId: number, take = 20) {
    return prisma.bankTransaction.findMany({
      where: { userId },
      orderBy: { transactionDate: "desc" },
      take,
      include: { bankAccount: { select: { bankName: true, accountName: true } } },
    });
  },

  creditImports(userId: number) {
    return prisma.creditImport.findMany({
      where: { userId },
      orderBy: [{ importYear: "desc" }, { importMonth: "desc" }],
      include: { _count: { select: { transactions: true } } },
    });
  },

  recurringPayments(userId: number) {
    return prisma.recurringPayment.findMany({
      where: { userId },
      orderBy: { nextPaymentDate: "asc" },
      include: { category: true, paymentMethod: true },
    });
  },

  subscriptions(userId: number) {
    return prisma.subscription.findMany({ where: { userId }, orderBy: { billingDate: "asc" } });
  },

  documents(userId: number) {
    return prisma.document.findMany({ where: { userId }, orderBy: { uploadedAt: "desc" } });
  },

  savingsGoals(userId: number) {
    return prisma.savingsGoal.findMany({ where: { userId }, orderBy: { id: "asc" } });
  },

  paymentMethods(userId: number) {
    return prisma.paymentMethod.findMany({ where: { userId }, orderBy: { id: "asc" } });
  },

  alerts(userId: number, take = 20) {
    return prisma.alert.findMany({
      where: { userId, withdrawnAt: null },
      orderBy: [{ isRead: "asc" }, { createdAt: "desc" }],
      take,
    });
  },

  reminders(userId: number) {
    return prisma.reminder.findMany({ where: { userId }, orderBy: { eventDate: "asc" } });
  },

  ownCategoriesCount(userId: number) {
    return prisma.category.count({ where: { userId } });
  },

  ownCategoryRulesCount(userId: number) {
    return prisma.categoryRule.count({ where: { userId } });
  },
};
