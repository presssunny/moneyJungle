import { readSessionCookie, validCsrf } from "../modules/gate/sessionCookie";
import { gateService } from "../modules/gate/gate.service";
import { ApiError } from "../utils/ApiError";
import { asyncHandler } from "../utils/asyncHandler";


/**
 * Protects every API route except gate login. Resolves the HttpOnly session cookie to
 * its actual owner via gateService.resolveSession and attaches that identity
 * to the request — req.userId, req.userRole, req.userEmail,
 * req.userDisplayName.
 *
 * Previously this always resolved to a single cached "primary user"
 * (`getPrimaryUserId()`), regardless of who — or whether anyone — was really
 * authenticated. That fallback has been removed entirely: every request now
 * carries the identity of the account whose session token it presented, and
 * every module in the app that reads `req.userId!` for ownership scoping
 * (incomes, expenses, loans, bank, ... — see the multi-user migration report)
 * gets the correct owner for free, without having been touched itself.
 */
export const gateAuth = asyncHandler(async (req, _res, next) => {
  const token = readSessionCookie(req);
  if (!token) throw ApiError.unauthorized("נדרשת התחברות");

  const identity = await gateService.resolveSession(token);
  if (!identity) throw ApiError.unauthorized("ההתחברות פגה, יש להתחבר מחדש");

  // Some existing GET handlers refresh derived records. Protect them too until they are read-only.
  const bootstrap = req.baseUrl === "/api/gate" && req.path === "/session" && req.method === "GET";
  if (!bootstrap && !validCsrf(token, req.get("X-CSRF-Token"))) throw ApiError.forbidden("אימות הבקשה נכשל — יש לרענן את העמוד");

  req.userId = identity.id;
  req.userRole = identity.role;
  req.userEmail = identity.email;
  req.userDisplayName = identity.displayName;
  next();
});
