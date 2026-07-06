import { prisma } from "../../config/database";
import { Prisma } from "../../../generated/prisma/client";

export const alertsRepository = {
  findAll(userId: number, onlyUnread = false) {
    return prisma.alert.findMany({
      where: { userId, ...(onlyUnread ? { isRead: false } : {}) },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  },

  findById(userId: number, id: number) {
    return prisma.alert.findFirst({ where: { id, userId } });
  },

  create(userId: number, data: Omit<Prisma.AlertUncheckedCreateInput, "userId">) {
    return prisma.alert.create({ data: { ...data, userId } });
  },

  markRead(id: number) {
    return prisma.alert.update({ where: { id }, data: { isRead: true } });
  },

  markAllRead(userId: number) {
    return prisma.alert.updateMany({ where: { userId, isRead: false }, data: { isRead: true } });
  },

  delete(id: number) {
    return prisma.alert.delete({ where: { id } });
  },
};
