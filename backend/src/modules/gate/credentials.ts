import crypto from "crypto";
import { env } from "../../config/env";

/**
 * The single place that answers "is this who they say they are?" — moving to JWT
 * or a real user table means replacing `verifyCredentials` and nothing else.
 * Today: one identity from the environment, never hard-coded.
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
 * Identity on success, `null` on failure — never a reason, so the caller cannot
 * leak whether the user name or the password was wrong. `username` is optional:
 * clients predating the login screen still authenticate on the password alone.
 */
export function verifyCredentials(username: string | undefined, password: string): Identity | null {
  const passwordOk = safeEqual(password, env.APP_GATE_PASSWORD);
  const usernameOk = username === undefined || safeEqual(username, env.APP_GATE_USERNAME);
  // Both comparisons always run, so a wrong user name costs the same as a wrong
  // password and the failure mode reveals nothing by timing.
  return passwordOk && usernameOk ? currentIdentity() : null;
}
