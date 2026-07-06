import { prisma } from "../../config/database";
import { ApiError } from "../../utils/ApiError";
import { decimalToNumber, percent, round2 } from "../../utils/money.utils";
import { spentByCategory } from "../dashboard/dashboard.service";
import { CopyBudgetsBody, UpsertBudgetBody } from "./budgets.validation";

export const budgetsService = {
  /** Budgets for a month, joined with actual spending (manual + confirmed credit). */
  async list(userId: number, year: number, month: number) {
    const [budgets, spent] = await Promise.all([
      prisma.budget.findMany({
        where: { userId, year, month },
        include: { category: true },
        orderBy: { id: "asc" },
      }),
      spentByCategory(userId, year, month),
    ]);

    let total = 0;
    let used = 0;
    const items = budgets.map((budget) => {
      const amount = decimalToNumber(budget.amount);
      const categorySpent = round2(spent.get(budget.categoryId) ?? 0);
      total += amount;
      used += categorySpent;
      return {
        id: budget.id,
        categoryId: budget.categoryId,
        category: budget.category,
        year: budget.year,
        month: budget.month,
        amount,
        spent: categorySpent,
        usedPercent: percent(categorySpent, amount),
        remaining: round2(amount - categorySpent),
      };
    });

    return {
      budgets: items,
      totals: {
        total: round2(total),
        used: round2(used),
        usedPercent: percent(used, total),
        remaining: round2(total - used),
      },
    };
  },

  async upsert(userId: number, body: UpsertBudgetBody) {
    const category = await prisma.category.findFirst({
      where: { id: body.categoryId, OR: [{ userId }, { userId: null }] },
    });
    if (!category) throw ApiError.badRequest("הקטגוריה לא נמצאה");

    return prisma.budget.upsert({
      where: {
        userId_categoryId_month_year: {
          userId,
          categoryId: body.categoryId,
          month: body.month,
          year: body.year,
        },
      },
      create: { userId, ...body },
      update: { amount: body.amount },
      include: { category: true },
    });
  },

  async remove(userId: number, id: number) {
    const existing = await prisma.budget.findFirst({ where: { id, userId } });
    if (!existing) throw ApiError.notFound("התקציב לא נמצא");
    await prisma.budget.delete({ where: { id } });
  },

  /** Copy the previous month's budgets into the given month (skips existing). */
  async copyFromPrevious(userId: number, body: CopyBudgetsBody) {
    const prev = new Date(body.year, body.month - 2, 1);
    const prevYear = prev.getFullYear();
    const prevMonth = prev.getMonth() + 1;

    const [source, existing] = await Promise.all([
      prisma.budget.findMany({ where: { userId, year: prevYear, month: prevMonth } }),
      prisma.budget.findMany({ where: { userId, year: body.year, month: body.month } }),
    ]);
    if (source.length === 0) {
      throw ApiError.badRequest("אין תקציבים בחודש הקודם להעתקה");
    }

    const existingCategoryIds = new Set(existing.map((b) => b.categoryId));
    const toCreate = source.filter((b) => !existingCategoryIds.has(b.categoryId));
    if (toCreate.length > 0) {
      await prisma.budget.createMany({
        data: toCreate.map((b) => ({
          userId,
          categoryId: b.categoryId,
          year: body.year,
          month: body.month,
          amount: b.amount,
        })),
      });
    }
    return { copied: toCreate.length, skipped: source.length - toCreate.length };
  },
};
