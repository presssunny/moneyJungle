import type { LoginMethod } from "../../types/connections.types";

/** A login the bank refused outright: retrying with the same details only moves the account toward a lock. */
export const BLOCKING_ERRORS = ["INVALID_PASSWORD", "CHANGE_PASSWORD", "ACCOUNT_BLOCKED"] as const;
// Not the bank's answer — a restart, her own cancel or closed window, our app, a browser that never
// started (nothing reached the bank), or a probe run's planned end — so no reason to make her wait.
const NO_COOLDOWN_ERRORS = ["INTERRUPTED", "CANCELLED", "BROWSER_CLOSED", "BROWSER_LAUNCH", "APP", "PROBE_DONE"];
export const RETRY_COOLDOWN_MS = 2 * 60_000;

export interface LastSync {
  status: string;
  errorType: string | null;
  finishedAt: Date | null;
}

export type RetryBlock = { reason: "credentials"; message: string; until: null } | { reason: "cooldown"; message: string; until: Date };

/** The one place that decides whether a new login may start now (start() enforces it, the API shows it). */
export function retryBlock(connection: { loginMethod: string; blockedReason: string | null }, last: LastSync | null | undefined, now = new Date()): RetryBlock | null {
  if (connection.blockedReason && (connection.loginMethod as LoginMethod) === "password") {
    return { reason: "credentials", until: null, message: "הבנק דחה את פרטי הכניסה השמורים. כדי שהחשבון לא יינעל, לא ננסה אותם שוב — אפשר לעבור לכניסה בחלון של הבנק." };
  }
  if (last?.status !== "failed" || !last.finishedAt || NO_COOLDOWN_ERRORS.includes(last.errorType ?? "")) return null;
  const until = new Date(last.finishedAt.getTime() + RETRY_COOLDOWN_MS);
  if (until <= now) return null;
  const minutes = Math.max(1, Math.ceil((until.getTime() - now.getTime()) / 60_000));
  return { reason: "cooldown", until, message: `הניסיון הקודם נכשל לפני רגע. אפשר לנסות שוב בעוד ${minutes} ${minutes === 1 ? "דקה" : "דקות"}.` };
}
