import { z } from "zod";

const credentialsSchema = z.record(z.string().max(40), z.string().max(200)).refine((value) => Object.keys(value).length <= 6, "יותר מדי שדות");

export const createConnectionSchema = z.object({
  provider: z.string().max(30),
  label: z.string().max(80).optional(),
  bankAccountId: z.number().int().positive().optional(),
  accountHint: z.string().max(20).optional(),
  credentials: credentialsSchema,
}).strict();

export const updateConnectionSchema = z.object({
  label: z.string().max(80).optional(),
  bankAccountId: z.number().int().positive().optional(),
  accountHint: z.string().max(20).optional(),
  credentials: credentialsSchema.optional(),
}).strict();

export type CreateConnectionBody = z.infer<typeof createConnectionSchema>;
export type UpdateConnectionBody = z.infer<typeof updateConnectionSchema>;
