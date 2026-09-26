import { prisma } from "../../config/database";
import type { Prisma } from "../../../generated/prisma/client";
import { ApiError } from "../../utils/ApiError";
import { clampPage, filteredSummary, ledgerRange, orderLedgerKeys } from "../../utils/ledger.utils";
import { monthTotals } from "../dashboard/dashboard.service";
import { monthRange } from "../../utils/date.utils";
import { decimalToNumber, sumDecimals } from "../../utils/money.utils";
import { incomesRepository } from "./incomes.repository";
import { CreateIncomeBody, INCOME_TYPE_LABELS, IncomeLedgerQuery, UpdateIncomeBody } from "./incomes.validation";

type IncomeRecord = NonNullable<Awaited<ReturnType<typeof incomesRepository.findById>>>;

const serialize = (income: IncomeRecord) => ({
  ...income,
  amount: decimalToNumber(income.amount),
});

export const incomesService = {
  async list(userId: number, year: number, month: number) {
    const { start, end } = monthRange(year, month);
    const incomes = await incomesRepository.findByMonth(userId, start, end);
    return {
      incomes: incomes.map(serialize),
      total: sumDecimals(incomes.map((i) => i.amount)),
    };
  },

  /** One page of the month's incomes, filtered on the server; the month total stays monthTotals' figure. */
  async ledger(userId: number, year: number, month: number, query: IncomeLedgerQuery) {
    const { start, end } = monthRange(year, month);
    const q = query.q?.trim();
    // Searching "משכורת" should find salaries whose description never says so.
    const typesByLabel = q ? Object.entries(INCOME_TYPE_LABELS).filter(([, label]) => label.includes(q)).map(([type]) => type) : [];
    const where: Prisma.IncomeWhereInput = {
      userId, incomeDate: ledgerRange(start, end, query.from, query.to), ...(query.type ? { type: query.type } : {}),
      ...(q ? { OR: [{ description: { contains: q } }, ...(typesByLabel.length ? [{ type: { in: typesByLabel } }] : [])] } : {}),
    };
    const [keys, byType, totals, monthCount, recurringCount] = await Promise.all([
      prisma.income.findMany({ where, select: { id: true, incomeDate: true, amount: true } }),
      prisma.income.groupBy({ by: ["type"], where, _sum: { amount: true } }),
      monthTotals(userId, year, month),
      prisma.income.count({ where: { userId, incomeDate: { gte: start, lt: end } } }),
      prisma.income.count({ where: { userId, incomeDate: { gte: start, lt: end }, isRecurring: true } }),
    ]);
    const ordered = orderLedgerKeys(keys.map((k) => ({ source: "income", id: k.id, date: k.incomeDate, amount: decimalToNumber(k.amount) })));
    const pageNumber = clampPage(query.page, query.pageSize, ordered.length);
    const pageIds = ordered.slice((pageNumber - 1) * query.pageSize, pageNumber * query.pageSize).map((k) => k.id);
    const rows = await prisma.income.findMany({ where: { userId, id: { in: pageIds } } });
    const byId = new Map(rows.map((row) => [row.id, serialize(row)]));
    return {
      items: pageIds.map((id) => byId.get(id)!),
      page: pageNumber, pageSize: query.pageSize,
      ...filteredSummary(ordered),
      /** The filtered rows grouped by kind, for the breakdown beside the table. */
      byType: byType.map((g) => ({ type: g.type, label: INCOME_TYPE_LABELS[g.type] ?? g.type, amount: decimalToNumber(g._sum.amount) })),
      monthTotal: totals.incomeTotal, monthCount, recurringCount,
    };
  },

  create(userId: number, body: CreateIncomeBody) {
    return incomesRepository
      .create(userId, {
        amount: body.amount,
        type: body.type,
        description: body.description ?? null,
        incomeDate: body.incomeDate,
        isRecurring: body.isRecurring ?? false,
      })
      .then(serialize);
  },

  async update(userId: number, id: number, body: UpdateIncomeBody) {
    const existing = await incomesRepository.findById(userId, id);
    if (!existing) throw ApiError.notFound("ההכנסה לא נמצאה");
    return incomesRepository.update(id, body).then(serialize);
  },

  async remove(userId: number, id: number) {
    const existing = await incomesRepository.findById(userId, id);
    if (!existing) throw ApiError.notFound("ההכנסה לא נמצאה");
    await incomesRepository.delete(id);
  },
};
