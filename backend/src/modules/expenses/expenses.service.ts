import { prisma } from "../../config/database";
import type { Prisma } from "../../../generated/prisma/client";
import { ApiError } from "../../utils/ApiError";
import { monthRange } from "../../utils/date.utils";
import { decimalToNumber, round2, sumDecimals } from "../../utils/money.utils";
import { spendingCredit } from "../dashboard/dashboard.repository";
import { monthTotals } from "../dashboard/dashboard.service";
import { filteredSummary, ledgerRange, orderLedgerKeys, type LedgerKey } from "../../utils/ledger.utils";
import { expensesRepository } from "./expenses.repository";
import { CreateExpenseBody, ExpenseLedgerQuery, UpdateExpenseBody } from "./expenses.validation";

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
  const lastMonthSpend = (await monthTotals(userId, prev.getFullYear(), prev.getMonth() + 1)).expenseTotal;

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
    const monthTotal = (await monthTotals(userId, year, month)).expenseTotal;
    return {
      expenses: rows,
      total: sumDecimals([...expenses.map((e) => e.amount), ...credit.map((c) => c.amount)]),
      progress: await buildProgress(userId, year, month, monthTotal),
    };
  },

  /**
   * One page of the month's expenses — manual rows and confirmed card rows merged
   * at read time, filtered on the server. The filter's own count and sum are
   * reported apart from the month total, which stays monthTotals' figure.
   */
  async ledger(userId: number, year: number, month: number, query: ExpenseLedgerQuery) {
    const { start, end } = monthRange(year, month);
    const range = ledgerRange(start, end, query.from, query.to);
    const q = query.q?.trim();
    const category = query.uncat ? { categoryId: null } : query.category ? { categoryId: query.category } : {};
    const expenseWhere: Prisma.ExpenseWhereInput = {
      userId, expenseDate: range, ...category, ...(query.recurring ? { isRecurring: true } : {}),
      ...(q ? { OR: [{ businessName: { contains: q } }, { description: { contains: q } }, { category: { name: { contains: q } } }] } : {}),
    };
    const creditWhere: Prisma.CreditTransactionWhereInput = {
      userId, billingDate: range, ...spendingCredit, ...category, ...(query.recurring ? { transactionType: "standing_order" } : {}),
      ...(q ? { OR: [{ businessName: { contains: q } }, { category: { name: { contains: q } } }] } : {}),
    };
    const [expenseKeys, creditKeys, totals, monthCounts] = await Promise.all([
      prisma.expense.findMany({ where: expenseWhere, select: { id: true, expenseDate: true, amount: true } }),
      prisma.creditTransaction.findMany({ where: creditWhere, select: { id: true, billingDate: true, amount: true } }),
      monthTotals(userId, year, month),
      Promise.all([
        prisma.expense.count({ where: { userId, expenseDate: { gte: start, lt: end } } }),
        prisma.creditTransaction.count({ where: { userId, billingDate: { gte: start, lt: end }, ...spendingCredit } }),
      ]),
    ]);
    const keys: LedgerKey[] = orderLedgerKeys([
      ...expenseKeys.map((r) => ({ source: "expense", id: r.id, date: r.expenseDate, amount: decimalToNumber(r.amount) })),
      ...creditKeys.map((r) => ({ source: "credit", id: r.id, date: r.billingDate, amount: decimalToNumber(r.amount) })),
    ]);
    const page = keys.slice((query.page - 1) * query.pageSize, query.page * query.pageSize);
    const idsOf = (source: string) => page.filter((k) => k.source === source).map((k) => k.id);
    const [expenses, credit] = await Promise.all([
      prisma.expense.findMany({ where: { userId, id: { in: idsOf("expense") } }, include: { category: true, paymentMethod: true } }),
      prisma.creditTransaction.findMany({ where: { userId, id: { in: idsOf("credit") } }, include: { category: true } }),
    ]);
    const bySource = new Map<string, ReturnType<typeof serialize> | ReturnType<typeof serializeCredit>>([
      ...expenses.map((r) => [`expense:${r.id}`, serialize(r)] as const),
      ...credit.map((r) => [`credit:${r.id}`, serializeCredit(r)] as const),
    ]);
    return {
      items: page.map((k) => bySource.get(`${k.source}:${k.id}`)!),
      page: query.page, pageSize: query.pageSize,
      ...filteredSummary(keys),
      monthTotal: totals.expenseTotal,
      monthCount: monthCounts[0] + monthCounts[1],
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
