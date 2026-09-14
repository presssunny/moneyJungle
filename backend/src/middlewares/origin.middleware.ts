import type { RequestHandler } from "express";
import { env } from "../config/env";
import { ApiError } from "../utils/ApiError";

export function allowedOrigin(origin: string): boolean {
  if (env.PUBLIC_ORIGIN === origin) return true;
  if (env.NODE_ENV === "production") return false;
  if (env.CORS_ORIGIN.split(",").map((value) => value.trim()).filter(Boolean).includes(origin)) return true;
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

export const checkOrigin: RequestHandler = (req, _res, next) => {
  const origin = req.get("Origin");
  if ((origin && !allowedOrigin(origin)) || (!origin && !["GET", "HEAD", "OPTIONS"].includes(req.method))) {
    return next(ApiError.forbidden("מקור הבקשה אינו מורשה"));
  }
  if (req.get("Sec-Fetch-Site") === "cross-site") return next(ApiError.forbidden("בקשה מאתר חיצוני אינה מורשית"));
  next();
};
