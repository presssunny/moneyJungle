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

export const INCOME_TYPE_LABELS: Record<string, string> = {
  salary: "משכורת",
  extra: "תוספת",
  business: "עסק",
  allowance: "קצבה",
  refund: "החזר",
  gift: "מתנה",
  one_time: "חד־פעמי",
  recurring: "קבוע",
};

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

export const incomeLedgerQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(10).max(100).default(50),
  q: z.string().trim().max(100).optional(),
  type: z.enum(incomeTypes).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
}).strict();
export type IncomeLedgerQuery = z.infer<typeof incomeLedgerQuerySchema>;
