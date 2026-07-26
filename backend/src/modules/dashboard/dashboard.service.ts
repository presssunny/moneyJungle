import { decimalToNumber, percent, round2 } from "../../utils/money.utils";
import { monthRange, toMonthKey } from "../../utils/date.utils";
import { computeLoan } from "../loans/loanCalculator.service";
import { loansRepository } from "../loans/loans.repository";
import { dashboardRepository } from "./dashboard.repository";

const SAVINGS_CATEGORY = "חיסכון";

async function monthTotals(userId: number, year: number, month: number) {
  const { start, end } = monthRange(year, month);
  const [incomes, expenses, credit] = await Promise.all([
    dashboardRepository.sumIncomes(userId, start, end),
    dashboardRepository.sumExpenses(userId, start, end),
    dashboardRepository.sumConfirmedCredit(userId, start, end),
  ]);
  const incomeTotal = decimalToNumber(incomes._sum.amount);
  const expenseManual = decimalToNumber(expenses._sum.amount);
  const creditTotal = decimalToNumber(credit._sum.amount);
  return {
    incomeTotal: round2(incomeTotal),
    expenseTotal: round2(expenseManual + creditTotal),
    creditTotal: round2(creditTotal),
  };
}

/**
 * Bank rows of one month, totalled by what they mean. Expense-bearing resolutions
 * are deliberately NOT re-added to any spend figure here: their amounts already
 * live in `expenses` (that is what the resolver created), and summing them again
 * would be the double count the whole design exists to prevent. They are reported
 * so the user can see which part of the expense total came from where.
 */
async function bankResolutionTotals(userId: number, year: number, month: number) {
  const { start, end } = monthRange(year, month);
  const groups = await dashboardRepository.bankRowsByResolution(userId, start, end);
  const totalOf = (resolution: string) =>
    round2(
      groups
        .filter((g) => g.resolution === resolution)
        .reduce((sum, g) => sum + decimalToNumber(g._sum.amount), 0)
    );
  const countOf = (resolution: string | null) =>
    groups.filter((g) => g.resolution === resolution).reduce((n, g) => n + g._count._all, 0);

  const financingCharged = totalOf("financing_charge");
  const financingCredited = totalOf("financing_credit");
  return {
    income: totalOf("income"),
    spend: totalOf("expense"),
    financingCharged,
    financingCredited,
    financingNet: round2(financingCharged - financingCredited),
    /** Loan principal + repayments the statement never split: debt, not spending. */
    debtReduction: round2(totalOf("debt_reduction") + totalOf("loan_repayment_unsplit")),
    principal: totalOf("debt_reduction"),
    loanUnsplit: totalOf("loan_repayment_unsplit"),
    loanDrawdown: totalOf("loan_drawdown"),
    /** Card bills already itemized in the credit tab — excluded, no double count. */
    cardSettled: totalOf("credit_card_settled"),
    /** Card bills nothing itemizes: counted as expense, flagged as coarse. */
    unitemizedCard: totalOf("credit_card_unitemized"),
    internalTransfer: totalOf("internal_transfer"),
    manualExcluded: totalOf("manual_excluded"),
    /** Rows with no meaning at all. Must be 0 — anything here is a real dead end. */
    unresolvedTotal: round2(
      groups
        .filter((g) => g.resolution === null)
        .reduce((sum, g) => sum + decimalToNumber(g._sum.amount), 0)
    ),
    unresolvedCount: countOf(null),
  };
}

/** Merged spent-per-category (manual expenses + confirmed credit) for a month. */
export async function spentByCategory(
  userId: number,
  year: number,
  month: number
): Promise<Map<number | null, number>> {
  const { start, end } = monthRange(year, month);
  const [expenseGroups, creditGroups] = await Promise.all([
    dashboardRepository.expensesByCategory(userId, start, end),
    dashboardRepository.creditByCategory(userId, start, end),
  ]);
  const spent = new Map<number | null, number>();
  for (const group of [...expenseGroups, ...creditGroups]) {
    const key = group.categoryId ?? null;
    spent.set(key, (spent.get(key) ?? 0) + decimalToNumber(group._sum.amount));
  }
  return spent;
}

export const dashboardService = {
  async summary(userId: number, year: number, month: number) {
    const totals = await monthTotals(userId, year, month);

    // Budget status
    const [budgets, spent, categories] = await Promise.all([
      dashboardRepository.budgets(userId, year, month),
      spentByCategory(userId, year, month),
      dashboardRepository.categories(userId),
    ]);
    let budgetTotal = 0;
    let budgetUsed = 0;
    let overrunCount = 0;
    for (const budget of budgets) {
      const amount = decimalToNumber(budget.amount);
      const used = spent.get(budget.categoryId) ?? 0;
      budgetTotal += amount;
      budgetUsed += used;
      if (used > amount) overrunCount += 1;
    }

    // Monthly savings = spending in the savings category
    const savingsCategory = categories.find((c) => c.name === SAVINGS_CATEGORY);
    const savingsMonthly = savingsCategory ? (spent.get(savingsCategory.id) ?? 0) : 0;

    // Loans
    const loans = await loansRepository.findActive(userId);
    let loanMonthlyPayment = 0;
    let loanMonthlyInterest = 0;
    let loanAnnualInterest = 0;
    let loanTotalBalance = 0;
    for (const loan of loans) {
      const computed = computeLoan({
        currentBalance: decimalToNumber(loan.currentBalance),
        annualInterestRate: decimalToNumber(loan.annualInterestRate),
        monthlyPayment: decimalToNumber(loan.monthlyPayment),
      });
      loanMonthlyPayment += decimalToNumber(loan.monthlyPayment);
      loanMonthlyInterest += computed.monthlyInterestPayment;
      loanAnnualInterest += computed.estimatedAnnualInterest;
      loanTotalBalance += decimalToNumber(loan.currentBalance);
    }

    // Money that reached the app but no figure yet — surfaced so the totals are
    // never mistaken for the whole story.
    const pendingBank = await dashboardRepository.pendingBankRows(userId);
    const pendingCount = pendingBank.reduce((n, g) => n + g._count._all, 0);
    const pendingPrincipal = pendingBank
      .filter((g) => g.lineKind === "loan_principal" || g.lineKind === "loan_mixed")
      .reduce((sum, g) => sum + decimalToNumber(g._sum.amount), 0);

    // Bank money that is real but is NOT spending, per resolution. Without these
    // the month looks like it lost money: 4,198.38 ₪ of loan repayment and 7,654.79 ₪
    // of already-itemized card settlements leave the account and appear in no
    // expense figure — correctly, but only if the dashboard names them.
    const bankMonth = await bankResolutionTotals(userId, year, month);

    return {
      incomeTotal: totals.incomeTotal,
      expenseTotal: totals.expenseTotal,
      balance: round2(totals.incomeTotal - totals.expenseTotal),
      creditTotal: totals.creditTotal,
      bankReview: {
        pendingCount,
        pendingPrincipal: round2(pendingPrincipal),
        unresolvedCount: bankMonth.unresolvedCount,
        needsAttention: round2(bankMonth.unitemizedCard + bankMonth.loanDrawdown),
      },
      /** Bank rows of this month by meaning — the audit trail for every figure above. */
      bankMonth,
      savingsMonthly: round2(savingsMonthly),
      budget: {
        total: round2(budgetTotal),
        used: round2(budgetUsed),
        usedPercent: percent(budgetUsed, budgetTotal),
        overrunCount,
      },
      loans: {
        monthlyPayment: round2(loanMonthlyPayment),
        monthlyInterest: round2(loanMonthlyInterest),
        annualInterest: round2(loanAnnualInterest),
        totalBalance: round2(loanTotalBalance),
        count: loans.length,
      },
    };
  },

  async charts(userId: number, year: number, month: number) {
    // Trend — last 6 months ending at the selected month
    const trend: Array<{ monthKey: string; income: number; expense: number }> = [];
    for (let offset = 5; offset >= 0; offset -= 1) {
      const d = new Date(year, month - 1 - offset, 1);
      const y = d.getFullYear();
      const m = d.getMonth() + 1;
      const totals = await monthTotals(userId, y, m);
      trend.push({ monthKey: toMonthKey(y, m), income: totals.incomeTotal, expense: totals.expenseTotal });
    }

    // By category (manual + credit merged)
    const [spent, categories] = await Promise.all([
      spentByCategory(userId, year, month),
      dashboardRepository.categories(userId),
    ]);
    const categoryById = new Map(categories.map((c) => [c.id, c]));
    const byCategory = [...spent.entries()]
      .map(([categoryId, value]) => {
        const category = categoryId !== null ? categoryById.get(categoryId) : undefined;
        return {
          name: category?.name ?? "לא מסווג",
          color: category?.color ?? "#6D6875",
          icon: category?.icon ?? "❓",
          value: round2(value),
        };
      })
      .filter((c) => c.value > 0)
      .sort((a, b) => b.value - a.value);

    // Credit only, by category
    const { start, end } = monthRange(year, month);
    const creditGroups = await dashboardRepository.creditByCategory(userId, start, end);
    const creditByCategory = creditGroups
      .map((group) => {
        const category = group.categoryId !== null ? categoryById.get(group.categoryId) : undefined;
        return {
          name: category?.name ?? "לא מסווג",
          color: category?.color ?? "#6D6875",
          value: round2(decimalToNumber(group._sum.amount)),
        };
      })
      .filter((c) => c.value > 0)
      .sort((a, b) => b.value - a.value);

    // Loans: interest vs principal per loan
    const loans = await loansRepository.findActive(userId);
    const loanSplit = loans.map((loan) => {
      const computed = computeLoan({
        currentBalance: decimalToNumber(loan.currentBalance),
        annualInterestRate: decimalToNumber(loan.annualInterestRate),
        monthlyPayment: decimalToNumber(loan.monthlyPayment),
      });
      return {
        name: loan.loanName,
        interest: computed.monthlyInterestPayment,
        principal: computed.monthlyPrincipalPayment,
      };
    });

    return { trend, byCategory, creditByCategory, loanSplit };
  },

  async recent(userId: number) {
    const [expenses, incomes, credit, alerts] = await Promise.all([
      dashboardRepository.recentExpenses(userId),
      dashboardRepository.recentIncomes(userId),
      dashboardRepository.recentCredit(userId),
      dashboardRepository.recentAlerts(userId),
    ]);
    return { expenses, incomes, credit, alerts };
  },
};
