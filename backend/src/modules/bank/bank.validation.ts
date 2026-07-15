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

export type CreateBankAccountBody = z.infer<typeof createBankAccountSchema>;
export type UpdateBankAccountBody = z.infer<typeof updateBankAccountSchema>;
export type CreateBankTransactionBody = z.infer<typeof createBankTransactionSchema>;
