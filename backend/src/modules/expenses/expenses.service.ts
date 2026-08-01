import { prisma } from "../../config/database";
import { ApiError } from "../../utils/ApiError";
import { monthRange } from "../../utils/date.utils";
import { decimalToNumber, round2, sumDecimals } from "../../utils/money.utils";
import { dashboardRepository } from "../dashboard/dashboard.repository";
import { expensesRepository } from "./expenses.repository";
import { CreateExpenseBody, UpdateExpenseBody } from "./expenses.validation";

type ExpenseRecord = Awaited<ReturnType<typeof expensesRepository.findByMonth>>[number];
type CreditRecord = Awaited<ReturnType<typeof expensesRepository.findCreditByMonth>>[number];

const serialize = (expense: ExpenseRecord) => ({
  ...expense,
  amount: decimalToNumber(expense.amount),
  source: expense.source ?? "manual",
});

// Present a credit-card transaction in the shape the expenses view expects.
// Marked source:"credit" so the UI shows it read-only (edited in the אשראי tab).
const serializeCredit = (tx: CreditRecord) => ({
  id: tx.id,
  amount: decimalToNumber(tx.amount),
  categoryId: tx.categoryId,
  paymentMethodId: null,
  businessName: tx.businessName,
  description: null,
  expenseDate: tx.billingDate,
  isRecurring: tx.transactionType === "standing_order",
  category: tx.category,
  paymentMethod: null,
  source: "credit" as const,
});

// Total spend (manual + confirmed credit) for a whole month — same rule the
// dashboard uses, so the benchmark is consistent everywhere.
async function monthSpend(userId: number, year: number, month: number): Promise<number> {
  const { start, end } = monthRange(year, month);
  const [expenses, credit] = await Promise.all([
    dashboardRepository.sumExpenses(userId, start, end),
    dashboardRepository.sumConfirmedCredit(userId, start, end),
  ]);
  return round2(decimalToNumber(expenses._sum.amount) + decimalToNumber(credit._sum.amount));
}

// Monthly-progress payload: where the month stands, a target to compare against
// (explicit goal, else last month's spend), and an end-of-month forecast at the
// current pace. Forecast is only meaningful for the month in progress.
async function buildProgress(userId: number, year: number, month: number, spent: number) {
  const now = new Date();
  const isCurrentMonth = now.getFullYear() === year && now.getMonth() + 1 === month;
  const isFuture =
    year > now.getFullYear() || (year === now.getFullYear() && month > now.getMonth() + 1);
  const daysInMonth = new Date(year, month, 0).getDate();
  const dayOfMonth = isCurrentMonth ? now.getDate() : isFuture ? 0 : daysInMonth;
  const daysLeft = Math.max(0, daysInMonth - dayOfMonth);
  const dailyBurn = dayOfMonth > 0 ? round2(spent / dayOfMonth) : 0;

  const settings = await prisma.settings.findUnique({ where: { userId } });
  const goal =
    settings?.monthlyTarget != null ? round2(decimalToNumber(settings.monthlyTarget)) : 0;
  const prev = new Date(year, month - 2, 1);
  const lastMonthSpend = await monthSpend(userId, prev.getFullYear(), prev.getMonth() + 1);

  const target = goal > 0 ? goal : lastMonthSpend > 0 ? lastMonthSpend : null;
  const targetSource: "goal" | "last_month" | "none" =
    goal > 0 ? "goal" : lastMonthSpend > 0 ? "last_month" : "none";

  return {
    spent: round2(spent),
    target,
    targetSource,
    goal: goal > 0 ? goal : null,
    lastMonthSpend: round2(lastMonthSpend),
    isCurrentMonth,
    isFuture,
    daysInMonth,
    dayOfMonth,
    daysLeft,
    dailyBurn,
    // Forecast at current pace; for a finished month it equals the actual spend.
    projected: isFuture ? null : round2(spent + dailyBurn * daysLeft),
  };
}

export const expensesService = {
  async list(userId: number, year: number, month: number, categoryId?: number) {
    const { start, end } = monthRange(year, month);
    // Unified view: manual/imported expenses + confirmed credit-card transactions.
    // Merged at read time (no data copy) so the dashboard, which already sums both
    // stores separately, is never double-counted.
    const [expenses, credit] = await Promise.all([
      expensesRepository.findByMonth(userId, start, end, categoryId),
      expensesRepository.findCreditByMonth(userId, start, end, categoryId),
    ]);
    const rows = [...expenses.map(serialize), ...credit.map(serializeCredit)].sort(
      (a, b) => new Date(b.expenseDate).getTime() - new Date(a.expenseDate).getTime()
    );
    // Progress compares the FULL month's spend to the target, so it must ignore
    // the category filter (use the unfiltered month total, not `rows`).
    const monthTotal =
      categoryId != null ? await monthSpend(userId, year, month) : sumDecimals([...expenses.map((e) => e.amount), ...credit.map((c) => c.amount)]);
    return {
      expenses: rows,
      total: sumDecimals([...expenses.map((e) => e.amount), ...credit.map((c) => c.amount)]),
      progress: await buildProgress(userId, year, month, monthTotal),
    };
  },

  create(userId: number, body: CreateExpenseBody) {
    return expensesRepository.create(userId, {
      amount: body.amount,
      categoryId: body.categoryId ?? null,
      paymentMethodId: body.paymentMethodId ?? null,
      businessName: body.businessName ?? null,
      description: body.description ?? null,
      expenseDate: body.expenseDate,
      isRecurring: body.isRecurring ?? false,
      source: "manual",
    });
  },

  async update(userId: number, id: number, body: UpdateExpenseBody) {
    const existing = await expensesRepository.findById(userId, id);
    if (!existing) throw ApiError.notFound("ההוצאה לא נמצאה");
    return expensesRepository.update(id, body);
  },

  async remove(userId: number, id: number) {
    const existing = await expensesRepository.findById(userId, id);
    if (!existing) throw ApiError.notFound("ההוצאה לא נמצאה");
    await expensesRepository.delete(id);
  },
};
