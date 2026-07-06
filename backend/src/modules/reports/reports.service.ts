import { prisma } from "../../config/database";
import { monthRange, toMonthKey } from "../../utils/date.utils";
import { decimalToNumber, round2 } from "../../utils/money.utils";
import { dashboardRepository } from "../dashboard/dashboard.repository";
import { spentByCategory } from "../dashboard/dashboard.service";

const INCOME_TYPE_LABELS: Record<string, string> = {
  salary: "משכורת",
  extra: "תוספת",
  business: "עסק",
  allowance: "קצבה",
  refund: "החזר",
  gift: "מתנה",
  one_time: "חד־פעמי",
  recurring: "קבוע",
};

async function monthTotals(userId: number, year: number, month: number) {
  const { start, end } = monthRange(year, month);
  const [incomes, expenses, credit] = await Promise.all([
    dashboardRepository.sumIncomes(userId, start, end),
    dashboardRepository.sumExpenses(userId, start, end),
    dashboardRepository.sumConfirmedCredit(userId, start, end),
  ]);
  const incomeTotal = round2(decimalToNumber(incomes._sum.amount));
  const expenseTotal = round2(
    decimalToNumber(expenses._sum.amount) + decimalToNumber(credit._sum.amount)
  );
  return { incomeTotal, expenseTotal, balance: round2(incomeTotal - expenseTotal) };
}

export const reportsService = {
  async monthly(userId: number, year: number, month: number) {
    const prevDate = new Date(year, month - 2, 1);
    const prevYear = prevDate.getFullYear();
    const prevMonth = prevDate.getMonth() + 1;
    const { start, end } = monthRange(year, month);

    const [current, previous, incomeGroups, spent, categories, expenses, creditTransactions] =
      await Promise.all([
        monthTotals(userId, year, month),
        monthTotals(userId, prevYear, prevMonth),
        prisma.income.groupBy({
          by: ["type"],
          where: { userId, incomeDate: { gte: start, lt: end } },
          _sum: { amount: true },
        }),
        spentByCategory(userId, year, month),
        dashboardRepository.categories(userId),
        prisma.expense.findMany({
          where: { userId, expenseDate: { gte: start, lt: end } },
          select: { expenseDate: true, amount: true },
        }),
        prisma.creditTransaction.findMany({
          where: {
            userId,
            transactionDate: { gte: start, lt: end },
            creditImport: { status: "confirmed" },
          },
          select: { transactionDate: true, amount: true },
        }),
      ]);

    const incomeByType = incomeGroups
      .map((group) => ({
        type: group.type,
        label: INCOME_TYPE_LABELS[group.type] ?? group.type,
        value: round2(decimalToNumber(group._sum.amount)),
      }))
      .sort((a, b) => b.value - a.value);

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

    // Cumulative daily spending across the month (manual + confirmed credit)
    const daysInMonth = new Date(year, month, 0).getDate();
    const perDay = new Array<number>(daysInMonth).fill(0);
    for (const expense of expenses) {
      perDay[expense.expenseDate.getUTCDate() - 1] += decimalToNumber(expense.amount);
    }
    for (const tx of creditTransactions) {
      perDay[tx.transactionDate.getUTCDate() - 1] += decimalToNumber(tx.amount);
    }
    let running = 0;
    const dailySpending = perDay.map((value, index) => {
      running += value;
      return { day: index + 1, daily: round2(value), cumulative: round2(running) };
    });

    return {
      monthKey: toMonthKey(year, month),
      previousMonthKey: toMonthKey(prevYear, prevMonth),
      current,
      previous,
      delta: {
        income: round2(current.incomeTotal - previous.incomeTotal),
        expense: round2(current.expenseTotal - previous.expenseTotal),
        balance: round2(current.balance - previous.balance),
      },
      incomeByType,
      byCategory,
      dailySpending,
    };
  },

  /** Income/expense/balance for the last N months (for the yearly trend view). */
  async trend(userId: number, year: number, month: number, months = 12) {
    const rows: Array<{
      monthKey: string;
      incomeTotal: number;
      expenseTotal: number;
      balance: number;
    }> = [];
    for (let offset = months - 1; offset >= 0; offset -= 1) {
      const d = new Date(year, month - 1 - offset, 1);
      const y = d.getFullYear();
      const m = d.getMonth() + 1;
      const totals = await monthTotals(userId, y, m);
      rows.push({ monthKey: toMonthKey(y, m), ...totals });
    }
    return rows;
  },
};
