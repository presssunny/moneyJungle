import { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { Prisma } from "../../generated/prisma/client";
import { ApiError } from "../utils/ApiError";
import { env } from "../config/env";

export function notFoundMiddleware(req: Request, res: Response) {
  res.status(404).json({ error: { message: `נתיב לא קיים: ${req.method} ${req.path}` } });
}

export function errorMiddleware(
  err: unknown,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  next: NextFunction
) {
  if (err instanceof ApiError) {
    return res.status(err.statusCode).json({
      error: { message: err.message, details: err.details },
    });
  }

  if (err instanceof ZodError) {
    return res.status(400).json({
      error: {
        message: "נתונים לא תקינים",
        details: err.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
    });
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      return res.status(409).json({ error: { message: "רשומה כזו כבר קיימת" } });
    }
    if (err.code === "P2025") {
      return res.status(404).json({ error: { message: "הרשומה לא נמצאה" } });
    }
  }

  console.error("Unhandled error:", err);
  return res.status(500).json({
    error: {
      message: "שגיאת שרת פנימית",
      ...(env.NODE_ENV === "development" && err instanceof Error
        ? { details: err.message }
        : {}),
    },
  });
}
