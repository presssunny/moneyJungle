import { prisma } from "../../config/database";
import { ApiError } from "../../utils/ApiError";
import { CreatePaymentMethodBody, UpdatePaymentMethodBody } from "./paymentMethods.validation";

const visibleTo = (userId: number) => ({ OR: [{ userId }, { userId: null }] });

export const paymentMethodsService = {
  list(userId: number) {
    return prisma.paymentMethod.findMany({
      where: visibleTo(userId),
      orderBy: { id: "asc" },
    });
  },

  create(userId: number, body: CreatePaymentMethodBody) {
    return prisma.paymentMethod.create({ data: { ...body, userId } });
  },

  async update(userId: number, id: number, body: UpdatePaymentMethodBody) {
    const existing = await prisma.paymentMethod.findFirst({ where: { id, ...visibleTo(userId) } });
    if (!existing) throw ApiError.notFound("אמצעי התשלום לא נמצא");
    return prisma.paymentMethod.update({ where: { id }, data: body });
  },

  async remove(userId: number, id: number) {
    const existing = await prisma.paymentMethod.findFirst({ where: { id, ...visibleTo(userId) } });
    if (!existing) throw ApiError.notFound("אמצעי התשלום לא נמצא");
    if (existing.isDefault) throw ApiError.badRequest("לא ניתן למחוק אמצעי תשלום ברירת מחדל");
    await prisma.paymentMethod.delete({ where: { id } });
  },
};
