import { prisma } from "../../config/database";
import { ApiError } from "../../utils/ApiError";
import { CreateSubscriptionBody, UpdateSubscriptionBody } from "./subscriptions.validation";

async function requireSubscription(userId: number, id: number) {
  const subscription = await prisma.subscription.findFirst({ where: { id, userId } });
  if (!subscription) throw ApiError.notFound("המנוי לא נמצא");
  return subscription;
}

export const subscriptionsService = {
  async list(userId: number) {
    const items = await prisma.subscription.findMany({
      where: { userId },
      orderBy: [{ status: "asc" }, { billingDate: "asc" }],
    });
    const monthlyTotal = items
      .filter((item) => item.status === "active")
      .reduce(
        (sum, item) => sum + (item.frequency === "yearly" ? Number(item.amount) / 12 : Number(item.amount)),
        0
      );
    return { items, monthlyTotal: Math.round(monthlyTotal * 100) / 100 };
  },

  create(userId: number, body: CreateSubscriptionBody) {
    return prisma.subscription.create({
      data: {
        userId,
        name: body.name,
        amount: body.amount,
        billingDate: body.billingDate,
        frequency: body.frequency,
        status: body.status ?? "active",
      },
    });
  },

  async update(userId: number, id: number, body: UpdateSubscriptionBody) {
    await requireSubscription(userId, id);
    return prisma.subscription.update({ where: { id }, data: body });
  },

  async remove(userId: number, id: number) {
    await requireSubscription(userId, id);
    await prisma.subscription.delete({ where: { id } });
  },
};
