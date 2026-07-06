import { Request, Response } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { MonthQuery, resolveMonth } from "../../utils/validation.utils";
import { dashboardService } from "./dashboard.service";

export const dashboardController = {
  summary: asyncHandler(async (req: Request, res: Response) => {
    const { year, month } = resolveMonth((req.validated?.query ?? {}) as MonthQuery);
    res.json(await dashboardService.summary(req.userId!, year, month));
  }),

  charts: asyncHandler(async (req: Request, res: Response) => {
    const { year, month } = resolveMonth((req.validated?.query ?? {}) as MonthQuery);
    res.json(await dashboardService.charts(req.userId!, year, month));
  }),

  recent: asyncHandler(async (req: Request, res: Response) => {
    res.json(await dashboardService.recent(req.userId!));
  }),
};
