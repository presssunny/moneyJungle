import { prisma } from "../../config/database";
import { ApiError } from "../../utils/ApiError";
import { CreateSavingsGoalBody, UpdateSavingsGoalBody } from "./savings.validation";

async function requireGoal(userId: number, id: number) {
  const goal = await prisma.savingsGoal.findFirst({ where: { id, userId } });
  if (!goal) throw ApiError.notFound("יעד החיסכון לא נמצא");
  return goal;
}

export const savingsService = {
  list(userId: number) {
    return prisma.savingsGoal.findMany({ where: { userId }, orderBy: { id: "asc" } });
  },

  create(userId: number, body: CreateSavingsGoalBody) {
    return prisma.savingsGoal.create({
      data: {
        userId,
        goalName: body.goalName,
        targetAmount: body.targetAmount,
        currentAmount: body.currentAmount,
        monthlyTarget: body.monthlyTarget ?? null,
        targetDate: body.targetDate ?? null,
      },
    });
  },

  async update(userId: number, id: number, body: UpdateSavingsGoalBody) {
    await requireGoal(userId, id);
    return prisma.savingsGoal.update({ where: { id }, data: body });
  },

  /** Positive amount deposits into the goal, negative withdraws (never below zero). */
  async deposit(userId: number, id: number, amount: number) {
    const goal = await requireGoal(userId, id);
    const next = Math.max(0, Number(goal.currentAmount) + amount);
    return prisma.savingsGoal.update({ where: { id }, data: { currentAmount: next } });
  },

  async remove(userId: number, id: number) {
    await requireGoal(userId, id);
    await prisma.savingsGoal.delete({ where: { id } });
  },
};
