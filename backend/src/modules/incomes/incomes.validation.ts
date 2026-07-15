import { z } from "zod";

export const incomeTypes = [
  "salary",
  "extra",
  "business",
  "allowance",
  "refund",
  "gift",
  "one_time",
  "recurring",
] as const;

export const createIncomeSchema = z.object({
  amount: z.coerce.number().positive("יש להזין סכום חיובי").max(9999999999, "הסכום גדול מדי"),
  type: z.enum(incomeTypes).default("salary"),
  description: z.string().max(255).nullish(),
  incomeDate: z.coerce.date(),
  isRecurring: z.boolean().optional(),
});

export const updateIncomeSchema = createIncomeSchema.partial();

export type CreateIncomeBody = z.infer<typeof createIncomeSchema>;
export type UpdateIncomeBody = z.infer<typeof updateIncomeSchema>;
