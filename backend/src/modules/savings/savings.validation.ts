import { z } from "zod";

export const createSavingsGoalSchema = z.object({
  goalName: z.string().min(1, "יש להזין שם יעד").max(120),
  targetAmount: z.coerce.number().positive("יש להזין סכום יעד").max(9999999999, "הסכום גדול מדי"),
  currentAmount: z.coerce.number().min(0).default(0),
  monthlyTarget: z.coerce.number().positive().nullish(),
  targetDate: z.coerce.date().nullish(),
});

export const updateSavingsGoalSchema = createSavingsGoalSchema.partial();

export const depositSchema = z.object({
  amount: z.coerce.number().refine((v) => v !== 0, "יש להזין סכום שונה מאפס"),
});

export type CreateSavingsGoalBody = z.infer<typeof createSavingsGoalSchema>;
export type UpdateSavingsGoalBody = z.infer<typeof updateSavingsGoalSchema>;
export type DepositBody = z.infer<typeof depositSchema>;
