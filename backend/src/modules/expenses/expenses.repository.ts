import { prisma } from "../../config/database";
import { Prisma } from "../../../generated/prisma/client";

export const expensesRepository = {
  findByMonth(userId: number, start: Date, end: Date, categoryId?: number) {
    return prisma.expense.findMany({
      where: {
        userId,
        expenseDate: { gte: start, lt: end },
        ...(categoryId ? { categoryId } : {}),
      },
      include: { category: true, paymentMethod: true },
      orderBy: [{ expenseDate: "desc" }, { id: "desc" }],
    });
  },

  findById(userId: number, id: number) {
    return prisma.expense.findFirst({ where: { id, userId } });
  },

  create(userId: number, data: Omit<Prisma.ExpenseUncheckedCreateInput, "userId">) {
    return prisma.expense.create({
      data: { ...data, userId },
      include: { category: true, paymentMethod: true },
    });
  },

  update(id: number, data: Prisma.ExpenseUncheckedUpdateInput) {
    return prisma.expense.update({
      where: { id },
      data,
      include: { category: true, paymentMethod: true },
    });
  },

  delete(id: number) {
    return prisma.expense.delete({ where: { id } });
  },
};
