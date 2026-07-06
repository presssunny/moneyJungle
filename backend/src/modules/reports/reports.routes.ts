import { Request, Response, Router } from "express";
import { gateAuth } from "../../middlewares/gateAuth.middleware";
import { validate } from "../../middlewares/validation.middleware";
import { asyncHandler } from "../../utils/asyncHandler";
import { MonthQuery, monthQuerySchema, resolveMonth } from "../../utils/validation.utils";
import { reportsService } from "./reports.service";

export const reportsRoutes = Router();

reportsRoutes.use(gateAuth);

reportsRoutes.get(
  "/monthly",
  validate({ query: monthQuerySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { year, month } = resolveMonth((req.validated?.query ?? {}) as MonthQuery);
    res.json(await reportsService.monthly(req.userId!, year, month));
  })
);

reportsRoutes.get(
  "/trend",
  validate({ query: monthQuerySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { year, month } = resolveMonth((req.validated?.query ?? {}) as MonthQuery);
    res.json(await reportsService.trend(req.userId!, year, month));
  })
);
