import { Request } from "express";
import { z } from "zod";

export const idParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export type IdParam = z.infer<typeof idParamSchema>;

/** Month query — defaults are resolved in services to the current month. */
export const monthQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
});

export type MonthQuery = z.infer<typeof monthQuerySchema>;

export function resolveMonth(query: MonthQuery): { year: number; month: number } {
  const now = new Date();
  return {
    year: query.year ?? now.getFullYear(),
    month: query.month ?? now.getMonth() + 1,
  };
}

/**
 * Reads a request part the `validate()` middleware already parsed. Throws
 * clearly if the route forgot to validate that part, instead of letting
 * `req.validated?.part as T` silently destructure `undefined`.
 */
function readValidated<T>(req: Request, part: "body" | "query" | "params"): T {
  const value = req.validated?.[part];
  if (value === undefined) {
    throw new Error(`req.validated.${part} is missing — did the route call validate({ ${part} })?`);
  }
  return value as T;
}

export function validatedBody<T>(req: Request): T {
  return readValidated<T>(req, "body");
}

export function validatedParams<T>(req: Request): T {
  return readValidated<T>(req, "params");
}

export function validatedQuery<T>(req: Request): T {
  return readValidated<T>(req, "query");
}
