import { z } from "zod";

export const loanTypes = ["bank", "credit", "car", "mortgage", "private", "other"] as const;
export const loanStatuses = ["active", "finished", "overdue"] as const;

export const createLoanSchema = z.object({
  loanName: z.string().min(1, "יש להזין שם הלוואה").max(120),
  loanType: z.enum(loanTypes).default("bank"),
  lenderName: z.string().max(120).nullish(),
  originalAmount: z.coerce.number().positive("יש להזין סכום מקורי"),
  currentBalance: z.coerce.number().min(0),
  annualInterestRate: z.coerce.number().min(0).max(100),
  monthlyPayment: z.coerce.number().positive("יש להזין החזר חודשי"),
  startDate: z.coerce.date(),
  endDate: z.coerce.date().nullish(),
  isIndexLinked: z.boolean().optional(),
  earlyRepaymentFee: z.coerce.number().min(0).nullish(),
  status: z.enum(loanStatuses).optional(),
});

export const updateLoanSchema = createLoanSchema.partial();

export type CreateLoanBody = z.infer<typeof createLoanSchema>;
export type UpdateLoanBody = z.infer<typeof updateLoanSchema>;
