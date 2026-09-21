import { NextFunction, Request, Response } from "express";
import { ApiError } from "../utils/ApiError";

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Minimal in-memory fixed-window rate limiter (no external dependency).
 * Enough to blunt brute-force attempts against the single shared gate password.
 * State is per-process; fine for this single-instance app.
 */
export function rateLimit(options: { windowMs: number; max: number; message?: string; key?: (req: Request) => string }) {
  const { windowMs, max, message = "יותר מדי ניסיונות, נסי שוב מאוחר יותר" } = options;
  const buckets = new Map<string, Bucket>();
  let nextCleanup = 0;

  return (req: Request, res: Response, next: NextFunction) => {
    const key = options.key?.(req) ?? req.ip ?? req.socket.remoteAddress ?? "unknown";
    const now = Date.now();
    if (now >= nextCleanup) {
      for (const [ip, entry] of buckets) if (entry.resetAt <= now) buckets.delete(ip);
      nextCleanup = now + Math.min(options.windowMs, 60000);
    }
    const bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      if (!bucket && buckets.size >= 10000) {
        res.setHeader("Retry-After", "60");
        throw ApiError.tooManyRequests(message);
      }
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    bucket.count += 1;
    if (bucket.count > max) {
      res.setHeader("Retry-After", String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))));
      throw ApiError.tooManyRequests(message);
    }
    next();
  };
}
