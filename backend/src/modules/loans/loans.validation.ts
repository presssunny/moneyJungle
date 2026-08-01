import { z } from "zod";

export const loanTypes = ["bank", "credit", "car", "mortgage", "private", "other"] as const;
export const loanStatuses = ["active", "finished", "overdue"] as const;

export const createLoanSchema = z.object({
  loanName: z.string().min(1, "יש להזין שם הלוואה").max(120),
  loanType: z.enum(loanTypes).default("bank"),
  lenderName: z.string().max(120).nullish(),
  originalAmount: z.coerce.number().positive("יש להזין סכום מקורי").max(9999999999, "הסכום גדול מדי"),
  currentBalance: z.coerce.number().min(0),
  annualInterestRate: z.coerce.number().min(0).max(100),
  monthlyPayment: z.coerce.number().positive("יש להזין החזר חודשי").max(9999999999, "הסכום גדול מדי"),
  startDate: z.coerce.date(),
  endDate: z.coerce.date().nullish(),
  isIndexLinked: z.boolean().optional(),
  earlyRepaymentFee: z.coerce.number().min(0).nullish(),
  status: z.enum(loanStatuses).optional(),
  /** Bank identity. Filled automatically by a schedule import. */
  loanNumber: z.string().max(30).nullish(),
  trackNumber: z.string().max(30).nullish(),
});

export const closureReasons = ["early_repayment", "scheduled", "refinanced"] as const;

export const closeLoanSchema = z.object({
  closedAt: z.coerce.date(),
  reason: z.enum(closureReasons).default("early_repayment"),
  /** Fees the bank charged for closing. */
  closureCost: z.coerce.number().min(0).max(9999999999).nullish(),
});

export const updateLoanSchema = createLoanSchema.partial();

export type CreateLoanBody = z.infer<typeof createLoanSchema>;
export type UpdateLoanBody = z.infer<typeof updateLoanSchema>;
export type CloseLoanBody = z.infer<typeof closeLoanSchema>;
