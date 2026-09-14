import crypto from "crypto";
import type { Request, Response } from "express";
import { env } from "../../config/env";

export const sessionCookieName = env.NODE_ENV === "production" ? "__Host-mj_session" : "mj_session";
const cookieOptions = { httpOnly: true, secure: env.NODE_ENV === "production", sameSite: "lax" as const, path: "/" };

export function readSessionCookie(req: Request): string | undefined {
  const matches = (req.headers.cookie ?? "").split(";").map((part) => part.trim()).filter((part) => part.startsWith(`${sessionCookieName}=`));
  if (matches.length !== 1) return undefined;
  const value = matches[0].slice(sessionCookieName.length + 1);
  return /^[a-f0-9]{64}$/.test(value) ? value : undefined;
}

export function setSessionCookie(res: Response, token: string, expires: Date) {
  res.cookie(sessionCookieName, token, { ...cookieOptions, expires });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(sessionCookieName, cookieOptions);
}

// The public CSRF proof cannot be used to recover the random session credential.
export function csrfForSession(token: string): string {
  return crypto.createHash("sha256").update(`moneyjungle-csrf:${token}`).digest("hex");
}

export function validCsrf(token: string, proof: string | undefined): boolean {
  return typeof proof === "string" && /^[a-f0-9]{64}$/.test(proof) &&
    crypto.timingSafeEqual(Buffer.from(csrfForSession(token)), Buffer.from(proof));
}
