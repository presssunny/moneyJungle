import { prisma } from "../../config/database";
import { ApiError } from "../../utils/ApiError";
import { monthRange } from "../../utils/date.utils";
import { CreateRecurringBody, UpdateRecurringBody } from "./recurring.validation";

async function requireRecurring(userId: number, id: number) {
  const recurring = await prisma.recurringPayment.findFirst({ where: { id, userId } });
  if (!recurring) throw ApiError.notFound("התשלום הקבוע לא נמצא");
  return recurring;
}

/** Same day-of-month as the recurring's anchor date, clamped to the target month's length. */
function paymentDateInMonth(anchor: Date, year: number, month: number): Date {
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const day = Math.min(anchor.getUTCDate(), daysInMonth);
  return new Date(Date.UTC(year, month - 1, day));
}

export const recurringService = {
  async list(userId: number) {
    const items = await prisma.recurringPayment.findMany({
      where: { userId },
      orderBy: { nextPaymentDate: "asc" },
      include: { category: true, paymentMethod: true },
    });
    // Monthly-equivalent cost so yearly payments aren't dropped from the total.
    const monthlyTotal =
      Math.round(
        items.reduce(
          (sum, item) => sum + Number(item.amount) / (item.frequency === "yearly" ? 12 : 1),
          0
        ) * 100
      ) / 100;
    return { items, monthlyTotal };
  },

  create(userId: number, body: CreateRecurringBody) {
    return prisma.recurringPayment.create({
      data: {
        userId,
        name: body.name,
        amount: body.amount,
        categoryId: body.categoryId ?? null,
        paymentMethodId: body.paymentMethodId ?? null,
        frequency: body.frequency,
        nextPaymentDate: body.nextPaymentDate,
      },
      include: { category: true, paymentMethod: true },
    });
  },

  async update(userId: number, id: number, body: UpdateRecurringBody) {
    await requireRecurring(userId, id);
    return prisma.recurringPayment.update({
      where: { id },
      data: body,
      include: { category: true, paymentMethod: true },
    });
  },

  async remove(userId: number, id: number) {
    await requireRecurring(userId, id);
    await prisma.recurringPayment.delete({ where: { id } });
  },

  /**
   * Materialize recurring payments into expenses for the given month:
   * monthly payments every month, yearly payments only in their anchor month.
   * A recurring payment is skipped when a recurring expense with the same name and
   * amount already exists in that month, so re-running is safe.
   */
  async generate(userId: number, year: number, month: number) {
    const all = await prisma.recurringPayment.findMany({ where: { userId } });
    // Yearly payments materialize only in the month they're anchored to.
    const recurrings = all.filter(
      (r) => r.frequency === "monthly" || r.nextPaymentDate.getUTCMonth() + 1 === month
    );
    const { start, end } = monthRange(year, month);
    const existing = await prisma.expense.findMany({
      where: { userId, isRecurring: true, expenseDate: { gte: start, lt: end } },
      select: { businessName: true, amount: true },
    });
    const existingKeys = new Set(existing.map((e) => `${e.businessName}|${Number(e.amount)}`));

    let created = 0;
    for (const recurring of recurrings) {
      if (existingKeys.has(`${recurring.name}|${Number(recurring.amount)}`)) continue;
      await prisma.expense.create({
        data: {
          userId,
          amount: recurring.amount,
          categoryId: recurring.categoryId,
          paymentMethodId: recurring.paymentMethodId,
          businessName: recurring.name,
          description: "תשלום קבוע",
          expenseDate: paymentDateInMonth(recurring.nextPaymentDate, year, month),
          isRecurring: true,
        },
      });
      created += 1;
    }
    return { created, skipped: recurrings.length - created };
  },
};
