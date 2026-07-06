import { prisma } from "../../config/database";
import { Prisma } from "../../../generated/prisma/client";

export const remindersRepository = {
  findAll(userId: number) {
    return prisma.reminder.findMany({
      where: { userId },
      orderBy: { eventDate: "asc" },
    });
  },

  findUpcoming(userId: number, from: Date, to: Date) {
    return prisma.reminder.findMany({
      where: { userId, isActive: true, eventDate: { gte: from, lte: to } },
      orderBy: { eventDate: "asc" },
    });
  },

  findById(userId: number, id: number) {
    return prisma.reminder.findFirst({ where: { id, userId } });
  },

  create(userId: number, data: Prisma.ReminderUncheckedCreateInput) {
    return prisma.reminder.create({ data: { ...data, userId } });
  },

  update(id: number, data: Prisma.ReminderUncheckedUpdateInput) {
    return prisma.reminder.update({ where: { id }, data });
  },

  delete(id: number) {
    return prisma.reminder.delete({ where: { id } });
  },
};
