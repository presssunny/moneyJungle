import { prisma } from "../../config/database";
import { Prisma } from "../../../generated/prisma/client";

export const incomesRepository = {
  findByMonth(userId: number, start: Date, end: Date) {
    return prisma.income.findMany({
      where: { userId, incomeDate: { gte: start, lt: end } },
      orderBy: [{ incomeDate: "desc" }, { id: "desc" }],
    });
  },

  findById(userId: number, id: number) {
    return prisma.income.findFirst({ where: { id, userId } });
  },

  create(userId: number, data: Omit<Prisma.IncomeUncheckedCreateInput, "userId">) {
    return prisma.income.create({ data: { ...data, userId } });
  },

  update(id: number, data: Prisma.IncomeUncheckedUpdateInput) {
    return prisma.income.update({ where: { id }, data });
  },

  delete(id: number) {
    return prisma.income.delete({ where: { id } });
  },
};
