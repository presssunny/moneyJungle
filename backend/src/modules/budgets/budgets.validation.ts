import { z } from "zod";

export const upsertBudgetSchema = z.object({
  categoryId: z.coerce.number().int().positive(),
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
  amount: z.coerce.number().min(0, "סכום התקציב לא יכול להיות שלילי"),
});

export const copyBudgetsSchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
});

export type UpsertBudgetBody = z.infer<typeof upsertBudgetSchema>;
export type CopyBudgetsBody = z.infer<typeof copyBudgetsSchema>;
