import { ApiError } from "../../utils/ApiError";
import { decimalToNumber, sumDecimals } from "../../utils/money.utils";
import { hashPassword } from "../../utils/password.utils";
import { crmRepository } from "./crm.repository";
import { CreateCustomerBody, UpdateCustomerBody } from "./crm.validation";

type Sums = Map<number, number>;

function toSumMap(groups: Array<{ userId: number; _sum: Record<string, unknown> }>, key: string): Sums {
  const map = new Map<number, number>();
  for (const g of groups) {
    map.set(g.userId, decimalToNumber(g._sum[key] as never));
  }
  return map;
}

export const crmService = {
  /**
   * One row per user (= per customer — the app has no separate customer
   * entity, see the mapping notes in crm.repository.ts and the CRM README
   * section). Counts and sums come straight from the same tables every other
   * screen in the app writes to — nothing here is invented or mocked.
   */
  async listCustomers() {
    const [users, incomeSums, expenseSums, loanSums, bankSums, activityGroups] = await Promise.all([
      crmRepository.listUsers(),
      crmRepository.sumIncomeByUser(),
      crmRepository.sumExpenseByUser(),
      crmRepository.sumActiveLoanBalanceByUser(),
      crmRepository.sumBankBalanceByUser(),
      crmRepository.lastActivityByUser(),
    ]);

    const incomeMap = toSumMap(incomeSums, "amount");
    const expenseMap = toSumMap(expenseSums, "amount");
    const loanMap = toSumMap(loanSums, "currentBalance");
    const bankMap = toSumMap(bankSums, "currentBalance");

    // Latest touch across incomes/expenses/loans/bank transactions, per user.
    const lastActivityMap = new Map<number, Date>();
    for (const group of activityGroups) {
      for (const row of group) {
        const max = (row as { _max: { updatedAt: Date | null } })._max.updatedAt;
        if (!max) continue;
        const current = lastActivityMap.get(row.userId);
        if (!current || max > current) lastActivityMap.set(row.userId, max);
      }
    }

    return users.map((user) => {
      const totalIncome = incomeMap.get(user.id) ?? 0;
      const totalExpense = expenseMap.get(user.id) ?? 0;
      const recordCount = Object.values(user._count).reduce((sum, n) => sum + n, 0);
      return {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
        counts: user._count,
        recordCount,
        hasActivity: recordCount > 0,
        totalIncome,
        totalExpense,
        netCashflow: sumDecimals([totalIncome, -totalExpense]),
        activeLoanBalance: loanMap.get(user.id) ?? 0,
        bankBalance: bankMap.get(user.id) ?? 0,
        lastActivityAt: lastActivityMap.get(user.id) ?? null,
      };
    });
  },

  /**
   * Full customer card: every domain the schema links to a user, grouped and
   * labelled, not a flat dump. Anything the Frontend can create for "a
   * customer" ends up in one of these sections IF it is actually persisted —
   * see the CRM mapping notes for the one confirmed field (family-member
   * relation) that the Frontend collects but never sends to the API.
   */
  async getCustomerDetail(id: number) {
    const user = await crmRepository.findUserById(id);
    if (!user) throw ApiError.notFound("הלקוח לא נמצא");

    const [
      settings,
      familyMembers,
      incomes,
      expenses,
      budgets,
      loans,
      bankAccounts,
      recentBankTransactions,
      creditImports,
      recurringPayments,
      subscriptions,
      documents,
      savingsGoals,
      paymentMethods,
      alerts,
      reminders,
      ownCategoriesCount,
      ownCategoryRulesCount,
    ] = await Promise.all([
      crmRepository.settings(id),
      crmRepository.familyMembers(id),
      crmRepository.incomes(id),
      crmRepository.expenses(id),
      crmRepository.budgets(id),
      crmRepository.loans(id),
      crmRepository.bankAccounts(id),
      crmRepository.recentBankTransactions(id),
      crmRepository.creditImports(id),
      crmRepository.recurringPayments(id),
      crmRepository.subscriptions(id),
      crmRepository.documents(id),
      crmRepository.savingsGoals(id),
      crmRepository.paymentMethods(id),
      crmRepository.alerts(id),
      crmRepository.reminders(id),
      crmRepository.ownCategoriesCount(id),
      crmRepository.ownCategoryRulesCount(id),
    ]);

    const num = decimalToNumber;

    return {
      profile: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
      familyMembers,
      settings: settings
        ? {
            theme: settings.theme,
            currency: settings.currency,
            language: settings.language,
            dateFormat: settings.dateFormat,
            activeMonth: settings.activeMonth,
            monthlyTarget: num(settings.monthlyTarget),
            createdAt: settings.createdAt,
            updatedAt: settings.updatedAt,
          }
        : null,
      financials: {
        incomes: incomes.map((i) => ({ ...i, amount: num(i.amount) })),
        incomeTotal: sumDecimals(incomes.map((i) => i.amount)),
        expenses: expenses.map((e) => ({
          ...e,
          amount: num(e.amount),
          categoryName: e.category?.name ?? null,
          paymentMethodName: e.paymentMethod?.name ?? null,
        })),
        expenseTotal: sumDecimals(expenses.map((e) => e.amount)),
        budgets: budgets.map((b) => ({ ...b, amount: num(b.amount), categoryName: b.category?.name ?? null })),
      },
      loans: loans.map((l) => ({
        ...l,
        originalAmount: num(l.originalAmount),
        currentBalance: num(l.currentBalance),
        annualInterestRate: num(l.annualInterestRate),
        monthlyPayment: num(l.monthlyPayment),
        earlyRepaymentFee: num(l.earlyRepaymentFee),
        closureCost: num(l.closureCost),
        scheduleEntryCount: l._count.schedule,
      })),
      bank: {
        accounts: bankAccounts.map((a) => ({
          ...a,
          initialBalance: num(a.initialBalance),
          currentBalance: num(a.currentBalance),
          anchorBalance: num(a.anchorBalance),
          transactionCount: a._count.transactions,
          statementCount: a._count.statements,
        })),
        totalBalance: sumDecimals(bankAccounts.map((a) => a.currentBalance)),
        recentTransactions: recentBankTransactions.map((t) => ({
          ...t,
          amount: num(t.amount),
          bankName: t.bankAccount.bankName,
          accountName: t.bankAccount.accountName,
        })),
      },
      credit: {
        imports: creditImports.map((c) => ({
          ...c,
          totalAmount: num(c.totalAmount),
          transactionCount: c._count.transactions,
        })),
      },
      recurringPayments: recurringPayments.map((r) => ({
        ...r,
        amount: num(r.amount),
        categoryName: r.category?.name ?? null,
        paymentMethodName: r.paymentMethod?.name ?? null,
      })),
      subscriptions: subscriptions.map((s) => ({ ...s, amount: num(s.amount) })),
      documents,
      savingsGoals: savingsGoals.map((g) => ({
        ...g,
        targetAmount: num(g.targetAmount),
        currentAmount: num(g.currentAmount),
        monthlyTarget: num(g.monthlyTarget),
      })),
      paymentMethods,
      alerts,
      reminders: reminders.map((r) => ({ ...r, estimatedAmount: num(r.estimatedAmount) })),
      personalization: {
        customCategoriesCount: ownCategoriesCount,
        customCategoryRulesCount: ownCategoryRulesCount,
      },
    };
  },

  /**
   * ADMIN-only account creation (enforced by requireRole in crm.routes.ts,
   * not re-checked here — this function trusts its caller the same way every
   * other *.service.ts in the app trusts its controller). Every new account
   * gets real credentials; there is no "create with no password" path.
   */
  async createCustomer(body: CreateCustomerBody) {
    const existing = await crmRepository.findByEmail(body.email);
    if (existing) throw ApiError.conflict("כבר קיים משתמש עם האימייל הזה");

    const passwordHash = await hashPassword(body.password);
    return crmRepository.createUser({
      name: body.name,
      email: body.email,
      passwordHash,
      role: body.role,
      status: body.status ?? "active",
    });
  },

  /**
   * ADMIN-only. `actingAdminId` blocks an admin from demoting or deactivating
   * their own account through this endpoint — the same self-lockout guard the
   * old family "can't delete the active user" check used to provide, adapted
   * to roles/status instead of deletion (accounts are never hard-deleted from
   * the CRM — see the report on why: cascade-deleting a user's entire
   * financial history as a side effect of "managing" them is not what
   * deactivate/activate is for).
   */
  async updateCustomer(id: number, body: UpdateCustomerBody, actingAdminId: number) {
    const existing = await crmRepository.findUserById(id);
    if (!existing) throw ApiError.notFound("הלקוח לא נמצא");

    if (id === actingAdminId) {
      if (body.role && body.role !== "ADMIN") {
        throw ApiError.badRequest("אי אפשר להסיר את הרשאת האדמין מהמשתמש הפעיל");
      }
      if (body.status && body.status !== "active") {
        throw ApiError.badRequest("אי אפשר להשבית את המשתמש הפעיל");
      }
    }

    if (body.email && body.email !== existing.email) {
      const conflict = await crmRepository.findByEmail(body.email);
      if (conflict && conflict.id !== id) throw ApiError.conflict("כבר קיים משתמש עם האימייל הזה");
    }

    const passwordHash = body.password ? await hashPassword(body.password) : undefined;

    return crmRepository.updateUser(id, {
      name: body.name,
      email: body.email,
      role: body.role,
      status: body.status,
      passwordHash,
    });
  },
};
