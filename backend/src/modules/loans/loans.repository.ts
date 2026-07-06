import { prisma } from "../../config/database";
import { Prisma } from "../../../generated/prisma/client";

export const loansRepository = {
  findAll(userId: number) {
    return prisma.loan.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });
  },

  findActive(userId: number) {
    return prisma.loan.findMany({ where: { userId, status: "active" } });
  },

  findById(userId: number, id: number) {
    return prisma.loan.findFirst({ where: { id, userId } });
  },

  create(userId: number, data: Omit<Prisma.LoanUncheckedCreateInput, "userId">) {
    return prisma.loan.create({ data: { ...data, userId } });
  },

  update(id: number, data: Prisma.LoanUncheckedUpdateInput) {
    return prisma.loan.update({ where: { id }, data });
  },

  delete(id: number) {
    return prisma.loan.delete({ where: { id } });
  },
};
