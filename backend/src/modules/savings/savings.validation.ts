import { z } from "zod";

const goalFields = {
  goalName: z.string().min(1, "יש להזין שם יעד").max(120),
  targetAmount: z.coerce.number().positive("יש להזין סכום יעד").max(9999999999, "הסכום גדול מדי"),
  currentAmount: z.coerce.number().min(0),
  monthlyTarget: z.coerce.number().positive().nullish(),
  targetDate: z.coerce.date().nullish(),
};

// A debt goal's target comes from the loan's balance on the server, so the client does not send one.
export const createSavingsGoalSchema = z.object({
  ...goalFields,
  targetAmount: goalFields.targetAmount.optional(),
  currentAmount: goalFields.currentAmount.default(0),
  goalType: z.enum(["savings", "purchase", "debt_payoff"]).default("savings"),
  loanId: z.coerce.number().int().positive().optional(),
}).refine((body) => body.goalType === "debt_payoff" ? body.loanId !== undefined : body.targetAmount !== undefined, {
  message: "יש להזין סכום יעד, או לבחור הלוואה ליעד סילוק",
});

// No defaults here: a field left out of an edit keeps its stored value.
export const updateSavingsGoalSchema = z.object(goalFields).partial();

export const depositSchema = z.object({
  amount: z.coerce.number().refine((v) => v !== 0, "יש להזין סכום שונה מאפס"),
});

export type CreateSavingsGoalBody = z.infer<typeof createSavingsGoalSchema>;
export type UpdateSavingsGoalBody = z.infer<typeof updateSavingsGoalSchema>;
export type DepositBody = z.infer<typeof depositSchema>;
