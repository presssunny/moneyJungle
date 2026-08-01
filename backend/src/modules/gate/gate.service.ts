import crypto from "crypto";
import { env } from "../../config/env";
import { ApiError } from "../../utils/ApiError";
import { currentIdentity, verifyCredentials, type Identity } from "./credentials";
import { gateRepository } from "./gate.repository";

const DAY_MS = 24 * 60 * 60 * 1000;

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export const gateService = {
  /**
   * Identity checking lives in `credentials.ts`; this service only turns a
   * verified identity into a session. Keeping the two apart is what makes
   * swapping in JWT/OAuth later a one-file change.
   */
  async login(
    username: string | undefined,
    password: string
  ): Promise<{ token: string; expiresAt: Date; user: Identity }> {
    const identity = verifyCredentials(username, password);
    if (!identity) {
      // One message for both failure modes — naming which field was wrong would
      // tell an attacker that the other one was right.
      throw ApiError.unauthorized("שם המשתמש או הסיסמה שגויים");
    }

    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + env.GATE_SESSION_DAYS * DAY_MS);

    await gateRepository.deleteExpired();
    await gateRepository.createSession(hashToken(token), expiresAt);

    return { token, expiresAt, user: identity };
  },

  /** Who a valid session belongs to. Single-user today; per-session later. */
  identity(): Identity {
    return currentIdentity();
  },

  async logout(token: string): Promise<void> {
    await gateRepository.deleteByTokenHash(hashToken(token));
  },

  async isValid(token: string): Promise<boolean> {
    const session = await gateRepository.findByTokenHash(hashToken(token));
    return session !== null && session.expiresAt.getTime() > Date.now();
  },
};
