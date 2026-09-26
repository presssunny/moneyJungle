import { financialStatus } from "../journey/coverage.service";
import { Request, Response } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { MonthQuery, resolveMonth } from "../../utils/validation.utils";
import { buildAchievements } from "./achievements.service";
import { dashboardService } from "./dashboard.service";
import { buildInsights } from "./insights.service";

export const dashboardController = {
  summary: asyncHandler(async (req: Request, res: Response) => {
    const { year, month } = resolveMonth((req.validated?.query ?? {}) as MonthQuery);
    const summary=await dashboardService.summary(req.userId!, year, month);
    const {dataVersion}=await financialStatus(req.userId!);
    res.json({...summary,dataVersion});
  }),

  charts: asyncHandler(async (req: Request, res: Response) => {
    const { year, month } = resolveMonth((req.validated?.query ?? {}) as MonthQuery);
    res.json(await dashboardService.charts(req.userId!, year, month));
  }),

  recent: asyncHandler(async (req: Request, res: Response) => {
    res.json(await dashboardService.recent(req.userId!));
  }),

  insights: asyncHandler(async (req: Request, res: Response) => {
    const { year, month } = resolveMonth((req.validated?.query ?? {}) as MonthQuery);
    res.json(await buildInsights(req.userId!, year, month));
  }),

  achievements: asyncHandler(async (req: Request, res: Response) => {
    const { year, month } = resolveMonth((req.validated?.query ?? {}) as MonthQuery);
    res.json(await buildAchievements(req.userId!, year, month));
  }),
};
