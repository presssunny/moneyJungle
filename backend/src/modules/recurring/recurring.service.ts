import { prisma } from "../../config/database";
import { ApiError } from "../../utils/ApiError";
import { statementCommitmentsService } from "../bank/statementCommitments.service";
import { CreateRecurringBody, UpdateRecurringBody } from "./recurring.validation";

async function requireRecurring(userId: number, id: number) {
  const recurring = await prisma.recurringPayment.findFirst({ where: { id, userId } });
  if (!recurring) throw ApiError.notFound("התשלום הקבוע לא נמצא");
  return recurring;
}

// A fixed payment is a forecast (buildUpcoming); the expense comes only from the bank or card row.
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
    const recurring = await requireRecurring(userId, id);
    await prisma.recurringPayment.delete({ where: { id } });
    await statementCommitmentsService.dismiss(userId, recurring.detectedKey);
  },
};
