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
export function rateLimit(options: { windowMs: number; max: number; message?: string }) {
  const { windowMs, max, message = "יותר מדי ניסיונות, נסי שוב מאוחר יותר" } = options;
  const buckets = new Map<string, Bucket>();

  return (req: Request, _res: Response, next: NextFunction) => {
    const key = req.ip ?? req.socket.remoteAddress ?? "unknown";
    const now = Date.now();
    const bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    bucket.count += 1;
    if (bucket.count > max) {
      throw ApiError.tooManyRequests(message);
    }
    next();
  };
}
