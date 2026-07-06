import { Request } from "express";
import { prisma } from "../config/database";
import { gateService } from "../modules/gate/gate.service";
import { ApiError } from "../utils/ApiError";
import { asyncHandler } from "../utils/asyncHandler";

export function extractBearerToken(req: Request): string | undefined {
  const header = req.headers.authorization;
  return header?.startsWith("Bearer ") ? header.slice(7) : undefined;
}

// Single-user MVP: every authenticated request acts as the primary user.
let cachedPrimaryUserId: number | null = null;

async function getPrimaryUserId(): Promise<number> {
  if (cachedPrimaryUserId !== null) return cachedPrimaryUserId;
  const user = await prisma.user.findFirst({ orderBy: { id: "asc" } });
  if (!user) throw ApiError.internal("לא נמצא משתמש ראשי — יש להריץ seed");
  cachedPrimaryUserId = user.id;
  return user.id;
}

/** Protects every API route except gate login. Attaches req.userId. */
export const gateAuth = asyncHandler(async (req, _res, next) => {
  const token = extractBearerToken(req);
  if (!token) throw ApiError.unauthorized("נדרשת התחברות");

  const valid = await gateService.isValid(token);
  if (!valid) throw ApiError.unauthorized("ההתחברות פגה, יש להתחבר מחדש");

  req.userId = await getPrimaryUserId();
  next();
});
