import { z } from "zod";

/** Multer puts multipart text fields on req.body as strings. */
export const uploadImportSchema = z.object({
  importMonth: z.coerce.number().int().min(1).max(12).optional(),
  importYear: z.coerce.number().int().min(2000).max(2100).optional(),
});

export const updateCreditTransactionSchema = z.object({
  categoryId: z.coerce.number().int().positive().nullable(),
});

export type UploadImportBody = z.infer<typeof uploadImportSchema>;
export type UpdateCreditTransactionBody = z.infer<typeof updateCreditTransactionSchema>;
