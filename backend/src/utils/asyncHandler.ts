import { NextFunction, Request, RequestHandler, Response } from "express";

import { prisma, withFinancialTransaction } from "../config/database";

type AsyncRouteHandler = (
  req: Request,
  res: Response,
  next: NextFunction
) => Promise<unknown>;

export const asyncHandler =
  (fn: AsyncRouteHandler): RequestHandler =>
  (req, res, next) => {
    const financial = req.userId && /^\/api\/(bank|credit|expenses|incomes|loans|recurring|subscriptions|reminders|savings|budgets|documents|imports|journey|dashboard|reports|updates)(\/|$)/.test(req.originalUrl);
    if (!financial || (req.method === "GET" && /\/documents\/\d+\/file/.test(req.originalUrl))) {
      Promise.resolve(fn(req, res, next)).catch(next);
      return;
    }
    // Do not acknowledge a write until its database transaction has committed.
    const send = res.send;
    const end = res.end;
    let flush: (() => void) | undefined;
    res.send = function(body) { flush = () => { send.call(res, body); }; return res; };
    res.end = function(...args: Parameters<Response["end"]>) { flush = () => { end.apply(res, args); }; return res; } as Response["end"];
    withFinancialTransaction(req.userId!, async () => {
      await fn(req, res, next);
      if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && !req.originalUrl.startsWith("/api/journey/")) {
        await prisma.financialProfile.upsert({ where: { userId: req.userId! }, create: { userId: req.userId!, revision: 1 }, update: { revision: { increment: 1 } } });
      }
    }).then(() => {
      res.send = send;
      res.end = end;
      flush?.();
    }).catch(error => {
      res.send = send;
      res.end = end;
      res.statusCode = 200;
      next(error);
    });
  };
