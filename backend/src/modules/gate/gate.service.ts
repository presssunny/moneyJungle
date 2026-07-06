import crypto from "crypto";
import { env } from "../../config/env";
import { ApiError } from "../../utils/ApiError";
import { gateRepository } from "./gate.repository";

const DAY_MS = 24 * 60 * 60 * 1000;

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/** Constant-time string comparison to avoid timing attacks on the gate password. */
function safeEqual(a: string, b: string): boolean {
  const hashA = crypto.createHash("sha256").update(a).digest();
  const hashB = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

export const gateService = {
  async login(password: string): Promise<{ token: string; expiresAt: Date }> {
    if (!safeEqual(password, env.APP_GATE_PASSWORD)) {
      throw ApiError.unauthorized("סיסמה שגויה");
    }

    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + env.GATE_SESSION_DAYS * DAY_MS);

    await gateRepository.deleteExpired();
    await gateRepository.createSession(hashToken(token), expiresAt);

    return { token, expiresAt };
  },

  async logout(token: string): Promise<void> {
    await gateRepository.deleteByTokenHash(hashToken(token));
  },

  async isValid(token: string): Promise<boolean> {
    const session = await gateRepository.findByTokenHash(hashToken(token));
    return session !== null && session.expiresAt.getTime() > Date.now();
  },
};
