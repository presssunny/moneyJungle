import { prisma } from "../../config/database";
import { Prisma } from "../../../generated/prisma/client";

/** Visible = the user's own rows plus system defaults (userId = null). */
const visibleTo = (userId: number) => ({ OR: [{ userId }, { userId: null }] });

export const categoriesRepository = {
  findAll(userId: number, type?: string) {
    return prisma.category.findMany({
      where: { ...visibleTo(userId), ...(type ? { type } : {}) },
      orderBy: [{ type: "asc" }, { name: "asc" }],
    });
  },

  findById(userId: number, id: number) {
    return prisma.category.findFirst({ where: { id, ...visibleTo(userId) } });
  },

  create(userId: number, data: Omit<Prisma.CategoryUncheckedCreateInput, "userId">) {
    return prisma.category.create({ data: { ...data, userId } });
  },

  update(id: number, data: Prisma.CategoryUncheckedUpdateInput) {
    return prisma.category.update({ where: { id }, data });
  },

  delete(id: number) {
    return prisma.category.delete({ where: { id } });
  },

  findAllRules(userId: number) {
    return prisma.categoryRule.findMany({
      where: visibleTo(userId),
      include: { category: true },
      orderBy: { keyword: "asc" },
    });
  },

  findRuleById(userId: number, id: number) {
    return prisma.categoryRule.findFirst({ where: { id, ...visibleTo(userId) } });
  },

  createRule(userId: number, data: { keyword: string; categoryId: number }) {
    return prisma.categoryRule.create({
      data: { ...data, userId },
      include: { category: true },
    });
  },

  updateRule(id: number, data: { keyword?: string; categoryId?: number }) {
    return prisma.categoryRule.update({
      where: { id },
      data,
      include: { category: true },
    });
  },

  deleteRule(id: number) {
    return prisma.categoryRule.delete({ where: { id } });
  },
};
