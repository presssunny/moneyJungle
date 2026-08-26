import { prisma } from "../../config/database";
import { ApiError } from "../../utils/ApiError";
import { CreatePaymentMethodBody, UpdatePaymentMethodBody } from "./paymentMethods.validation";

/** For reads: your own methods plus the system-wide defaults (userId = null). */
const visibleTo = (userId: number) => ({ OR: [{ userId }, { userId: null }] });

/**
 * For mutations: owned by you, full stop — never `userId: null`. Using
 * `visibleTo` here was the bug: it let any authenticated user rename or
 * delete a *system-wide* default payment method (shared by every account),
 * since a null-owner row is "visible to" everyone. `remove()` happened to be
 * saved by its separate `isDefault` check (every seeded system default has
 * `isDefault: true`), but `update()` had no such guard at all — one account
 * could silently corrupt a default every other account also sees.
 */
const ownedBy = (userId: number) => ({ userId });

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
    const existing = await prisma.paymentMethod.findFirst({ where: { id, ...ownedBy(userId) } });
    if (!existing) throw ApiError.notFound("אמצעי התשלום לא נמצא");
    return prisma.paymentMethod.update({ where: { id }, data: body });
  },

  async remove(userId: number, id: number) {
    const existing = await prisma.paymentMethod.findFirst({ where: { id, ...ownedBy(userId) } });
    if (!existing) throw ApiError.notFound("אמצעי התשלום לא נמצא");
    if (existing.isDefault) throw ApiError.badRequest("לא ניתן למחוק אמצעי תשלום ברירת מחדל");
    await prisma.paymentMethod.delete({ where: { id } });
  },
};
