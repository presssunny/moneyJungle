import crypto from "crypto";
import { env } from "../../config/env";

/**
 * The single place that answers "is this who they say they are?". Nothing else
 * reads a credential directly, so moving to JWT, OAuth or a real user table means
 * replacing the body of `verifyCredentials` and nothing else.
 *
 * Today: one development identity from the environment — never hard-coded, never
 * read in a second place.
 */

export interface Identity {
  username: string;
  /** Shown in the UI; separate from `username` so a real name can differ later. */
  displayName: string;
}

/**
 * Constant-time comparison. Hashing first keeps `timingSafeEqual` happy with
 * different-length inputs while still leaking nothing about the real value.
 */
function safeEqual(a: string, b: string): boolean {
  const hashA = crypto.createHash("sha256").update(a).digest();
  const hashB = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

/** The identity this installation authenticates as. Single-user for now. */
export function currentIdentity(): Identity {
  return { username: env.APP_GATE_USERNAME, displayName: env.APP_GATE_USERNAME };
}

/**
 * Verify a login attempt. Returns the identity on success, `null` on failure —
 * never a reason, so the caller cannot accidentally tell an attacker whether it
 * was the user name or the password that was wrong.
 *
 * `username` is optional for backwards compatibility: sessions created before
 * the login screen gained a user field still authenticate on the password alone.
 */
export function verifyCredentials(username: string | undefined, password: string): Identity | null {
  const passwordOk = safeEqual(password, env.APP_GATE_PASSWORD);
  const usernameOk = username === undefined || safeEqual(username, env.APP_GATE_USERNAME);
  // Both comparisons always run, so a wrong user name costs the same as a wrong
  // password and the failure mode reveals nothing by timing.
  return passwordOk && usernameOk ? currentIdentity() : null;
}
