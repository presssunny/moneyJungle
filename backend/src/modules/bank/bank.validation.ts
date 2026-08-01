import { z } from "zod";

export const bankTransactionTypes = ["deposit", "withdrawal", "transfer", "fee", "other"] as const;

export const createBankAccountSchema = z.object({
  bankName: z.string().min(1, "יש להזין שם בנק").max(120),
  accountName: z.string().min(1, "יש להזין שם חשבון").max(120),
  initialBalance: z.coerce.number().default(0),
});

export const updateBankAccountSchema = createBankAccountSchema.partial();

export const createBankTransactionSchema = z.object({
  transactionDate: z.coerce.date(),
  description: z.string().max(255).nullish(),
  amount: z.coerce.number().positive("יש להזין סכום חיובי").max(9999999999, "הסכום גדול מדי"),
  type: z.enum(bankTransactionTypes).default("withdrawal"),
  categoryId: z.coerce.number().int().positive().nullish(),
});

// ---------- Reconciliation ----------

export const incomeTypes = ["salary", "extra", "business", "allowance", "refund", "gift", "one_time"] as const;

export const reconcileIncomeSchema = z.object({
  type: z.enum(incomeTypes).default("extra"),
  description: z.string().max(255).nullish(),
});

export const reconcileExpenseSchema = z.object({
  categoryId: z.coerce.number().int().positive().nullish(),
});

export const reconcileLoanSchema = z.object({
  loanId: z.coerce.number().int().positive().optional(),
  transactionIds: z.array(z.coerce.number().int().positive()).min(1, "יש לבחור לפחות תנועה אחת"),
  loanName: z.string().max(120).optional(),
  loanType: z.enum(["bank", "credit", "car", "mortgage", "private", "other"]).optional(),
  lenderName: z.string().max(120).nullish(),
  originalAmount: z.coerce.number().nonnegative().optional(),
  currentBalance: z.coerce.number().nonnegative().optional(),
  annualInterestRate: z.coerce.number().nonnegative().max(100).optional(),
  monthlyPayment: z.coerce.number().nonnegative().optional(),
  startDate: z.string().optional(),
});

/** A balance can legitimately be negative (overdraft) — no nonnegative here. */
export const setAnchorSchema = z.object({
  balance: z.coerce.number(),
  asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "נדרש תאריך בפורמט YYYY-MM-DD"),
});

export type SetAnchorBody = z.infer<typeof setAnchorSchema>;
export type CreateBankAccountBody = z.infer<typeof createBankAccountSchema>;
export type UpdateBankAccountBody = z.infer<typeof updateBankAccountSchema>;
export type CreateBankTransactionBody = z.infer<typeof createBankTransactionSchema>;
export type ReconcileIncomeBody = z.infer<typeof reconcileIncomeSchema>;
export type ReconcileExpenseBody = z.infer<typeof reconcileExpenseSchema>;
export type ReconcileLoanBody = z.infer<typeof reconcileLoanSchema>;
