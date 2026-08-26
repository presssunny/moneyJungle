import crypto from "crypto";
import { env } from "../../config/env";
import { ApiError } from "../../utils/ApiError";
import { verifyCredentials, type AccountStatus, type Identity, type Role } from "./credentials";
import { gateRepository } from "./gate.repository";

const DAY_MS = 24 * 60 * 60 * 1000;

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export const gateService = {
  /**
   * Identity checking lives in `credentials.ts`; this service only turns a
   * verified identity into a session tied to that specific account. Keeping
   * the two apart is what makes swapping in JWT/OAuth later a one-file change.
   */
  async login(email: string, password: string): Promise<{ token: string; expiresAt: Date; user: Identity }> {
    const identity = await verifyCredentials(email, password);
    if (!identity) {
      // One message for every failure mode — naming which part was wrong (or
      // whether the account exists/is disabled) would leak that information.
      throw ApiError.unauthorized("שם המשתמש או הסיסמה שגויים");
    }

    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + env.GATE_SESSION_DAYS * DAY_MS);

    await gateRepository.deleteExpired();
    await gateRepository.createSession(identity.id, hashToken(token), expiresAt);

    return { token, expiresAt, user: identity };
  },

  /**
   * Resolves a bearer token to the account it actually belongs to — the one
   * place that answers "who is this, really?" for every protected request
   * (gateAuth.middleware.ts) and for GET /gate/session. Returns null for a
   * missing/expired session OR for an account that has since been disabled,
   * so a deactivated user is logged out on their very next request even with
   * a token that hasn't technically expired yet.
   */
  async resolveSession(token: string): Promise<Identity | null> {
    const session = await gateRepository.findByTokenHash(hashToken(token));
    if (!session || session.expiresAt.getTime() <= Date.now()) return null;

    const user = session.user;
    if (!user.email || user.status !== "active") return null;

    return {
      id: user.id,
      email: user.email,
      displayName: user.name,
      role: user.role as Role,
      status: user.status as AccountStatus,
    };
  },

  async logout(token: string): Promise<void> {
    await gateRepository.deleteByTokenHash(hashToken(token));
  },
};
