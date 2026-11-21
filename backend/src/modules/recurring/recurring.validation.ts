import { z } from "zod";

export const recurringFrequencies = ["monthly", "yearly"] as const;

export const createRecurringSchema = z.object({
  name: z.string().min(1, "יש להזין שם").max(120),
  amount: z.coerce.number().positive("יש להזין סכום חיובי").max(9999999999, "הסכום גדול מדי"),
  categoryId: z.coerce.number().int().positive().nullish(),
  paymentMethodId: z.coerce.number().int().positive().nullish(),
  frequency: z.enum(recurringFrequencies).default("monthly"),
  nextPaymentDate: z.coerce.date(),
});

export const updateRecurringSchema = createRecurringSchema.partial();

export type CreateRecurringBody = z.infer<typeof createRecurringSchema>;
export type UpdateRecurringBody = z.infer<typeof updateRecurringSchema>;
