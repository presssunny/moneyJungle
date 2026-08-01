import { z } from "zod";

export const createExpenseSchema = z.object({
  amount: z.coerce.number().positive("יש להזין סכום חיובי").max(9999999999, "הסכום גדול מדי"),
  categoryId: z.coerce.number().int().positive().nullish(),
  paymentMethodId: z.coerce.number().int().positive().nullish(),
  businessName: z.string().max(255).nullish(),
  description: z.string().max(255).nullish(),
  expenseDate: z.coerce.date(),
  isRecurring: z.boolean().optional(),
});

export const updateExpenseSchema = createExpenseSchema.partial();

export const listExpensesQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
  categoryId: z.coerce.number().int().positive().optional(),
});

export const quickAddSchema = z.object({
  text: z.string().min(1, "יש להקליד טקסט").max(255),
});

export type CreateExpenseBody = z.infer<typeof createExpenseSchema>;
export type UpdateExpenseBody = z.infer<typeof updateExpenseSchema>;
export type ListExpensesQuery = z.infer<typeof listExpensesQuerySchema>;
export type QuickAddBody = z.infer<typeof quickAddSchema>;
