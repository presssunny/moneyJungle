import { z } from "zod";

// No credentials field: since 2026-10-20 she signs in on the provider's own page, never in ours.
// `.strict()` turns a body that still sends them into a validation error rather than a silent drop.
const loginMethodSchema = z.enum(["official_window"]);

export const createConnectionSchema = z.object({
  provider: z.string().max(30),
  label: z.string().max(80).optional(),
  bankAccountId: z.number().int().positive().optional(),
  accountHint: z.string().max(20).optional(),
  loginMethod: loginMethodSchema.optional(),
}).strict();

export const updateConnectionSchema = z.object({
  label: z.string().max(80).optional(),
  bankAccountId: z.number().int().positive().optional(),
  accountHint: z.string().max(20).optional(),
  loginMethod: loginMethodSchema.optional(),
}).strict();

export type CreateConnectionBody = z.input<typeof createConnectionSchema>;
export type UpdateConnectionBody = z.infer<typeof updateConnectionSchema>;
