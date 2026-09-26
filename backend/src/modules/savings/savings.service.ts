import { prisma } from "../../config/database";
import type { Prisma } from "../../../generated/prisma/client";
import { ApiError } from "../../utils/ApiError";
import { decimalToNumber, round2 } from "../../utils/money.utils";
import { CreateSavingsGoalBody, UpdateSavingsGoalBody } from "./savings.validation";

export const withLoan = { loan: { select: { id: true, loanName: true, currentBalance: true, status: true, updatedAt: true } } } as const;
type GoalRecord = Prisma.SavingsGoalGetPayload<{ include: typeof withLoan }>;

export interface GoalProgress {
  current: number;
  target: number;
  remaining: number;
  percent: number;
  complete: boolean;
  /** manual: entered deposits; loan: the linked loan's balance; unavailable: the loan is gone. */
  source: "manual" | "loan" | "unavailable";
  /** Loan goals: when that balance was last written. It moves on a schedule import, an edit or a closure — not on each monthly debit. */
  asOf: string | null;
}

/**
 * A debt goal's target is the loan balance when the goal was set; what is left is
 * the loan's recorded balance now. A balance that grew above the target shows the
 * real amount owed, with progress held at zero rather than negative.
 */
export function goalProgress(goal: GoalRecord): GoalProgress {
  const target = decimalToNumber(goal.targetAmount);
  if (goal.goalType !== "debt_payoff") {
    const saved = decimalToNumber(goal.currentAmount);
    return { ...progressOf(saved, target), remaining: round2(Math.max(0, target - saved)), complete: saved >= target, source: "manual", asOf: null };
  }
  if (!goal.loan) return { current: 0, target, remaining: target, percent: 0, complete: false, source: "unavailable", asOf: null };
  const owed = goal.loan.status === "finished" ? 0 : decimalToNumber(goal.loan.currentBalance);
  return {
    ...progressOf(Math.max(0, target - owed), target), remaining: round2(owed), complete: owed <= 0,
    source: "loan", asOf: goal.loan.updatedAt.toISOString(),
  };
}

function progressOf(current: number, target: number) {
  return { current: round2(current), target, percent: target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0 };
}

async function requireGoal(userId: number, id: number) {
  const goal = await prisma.savingsGoal.findFirst({ where: { id, userId }, include: withLoan });
  if (!goal) throw ApiError.notFound("היעד לא נמצא");
  return goal;
}

function present(goal: GoalRecord) {
  return { ...goal, progress: goalProgress(goal) };
}

export const savingsService = {
  async list(userId: number) {
    const goals = (await prisma.savingsGoal.findMany({ where: { userId }, include: withLoan, orderBy: { id: "asc" } })).map(present);
    // Paying a loan down is not saving: debt goals never count toward money set aside.
    const setAside = goals.filter((goal) => goal.goalType !== "debt_payoff");
    const savedTotal = round2(setAside.reduce((sum, goal) => sum + goal.progress.current, 0));
    const targetTotal = round2(setAside.reduce((sum, goal) => sum + goal.progress.target, 0));
    return {
      goals,
      summary: {
        savedTotal, targetTotal, setAsideCount: setAside.length,
        completion: targetTotal > 0 ? Math.round((savedTotal / targetTotal) * 100) : null,
      },
    };
  },

  async create(userId: number, body: CreateSavingsGoalBody) {
    const base = { userId, goalName: body.goalName, monthlyTarget: body.monthlyTarget ?? null, targetDate: body.targetDate ?? null };
    if (body.goalType === "debt_payoff") {
      const loan = body.loanId ? await prisma.loan.findFirst({ where: { id: body.loanId, userId } }) : null;
      if (!loan) throw ApiError.badRequest("יש לבחור הלוואה קיימת לסילוק");
      if (loan.status === "finished") throw ApiError.badRequest("ההלוואה הזו כבר סולקה");
      const balance = decimalToNumber(loan.currentBalance);
      if (balance <= 0) throw ApiError.badRequest("להלוואה אין יתרה פתוחה");
      return present(await prisma.savingsGoal.create({
        data: { ...base, goalType: "debt_payoff", loanId: loan.id, targetAmount: balance, currentAmount: 0 },
        include: withLoan,
      }));
    }
    if (body.targetAmount === undefined) throw ApiError.badRequest("יש להזין סכום יעד");
    return present(await prisma.savingsGoal.create({
      data: { ...base, goalType: body.goalType, targetAmount: body.targetAmount, currentAmount: body.currentAmount },
      include: withLoan,
    }));
  },

  async update(userId: number, id: number, body: UpdateSavingsGoalBody) {
    const goal = await requireGoal(userId, id);
    if (goal.goalType === "debt_payoff" && (body.targetAmount !== undefined || body.currentAmount !== undefined)) {
      throw ApiError.badRequest("התקדמות בסילוק הלוואה נקראת מיתרת ההלוואה ואינה נערכת ידנית");
    }
    return present(await prisma.savingsGoal.update({ where: { id }, data: body, include: withLoan }));
  },

  /** Positive amount deposits into the goal, negative withdraws (never below zero). */
  async deposit(userId: number, id: number, amount: number) {
    const goal = await requireGoal(userId, id);
    if (goal.goalType === "debt_payoff") throw ApiError.badRequest("התקדמות בסילוק הלוואה נקראת מיתרת ההלוואה ואינה נערכת ידנית");
    const next = Math.max(0, decimalToNumber(goal.currentAmount) + amount);
    return present(await prisma.savingsGoal.update({ where: { id }, data: { currentAmount: next }, include: withLoan }));
  },

  async remove(userId: number, id: number) {
    await requireGoal(userId, id);
    await prisma.savingsGoal.delete({ where: { id } });
  },
};
