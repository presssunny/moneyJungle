import { NextFunction, Request, Response } from "express";
import { ApiError } from "../utils/ApiError";

type Role = "ADMIN" | "USER" | "VIEWER";

/**
 * Backend-enforced RBAC — the Frontend hiding a button is UX, not
 * authorization; this is what actually blocks the request. Must run after
 * `gateAuth` (needs `req.userRole`, which only gateAuth sets).
 *
 * Used on the CRM routes: `requireRole("ADMIN", "VIEWER")` keeps plain USER
 * accounts out of the CRM entirely; `requireRole("ADMIN")` on top of that on
 * the mutating routes keeps VIEWER read-only even though it can reach the
 * CRM's read endpoints.
 */
export function requireRole(...allowed: Role[]) {
  return function (req: Request, _res: Response, next: NextFunction) {
    if (!req.userRole) throw ApiError.unauthorized("נדרשת התחברות");
    if (!allowed.includes(req.userRole)) throw ApiError.forbidden("אין לך הרשאה לפעולה זו");
    next();
  };
}
