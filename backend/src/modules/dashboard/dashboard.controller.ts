import { Request, Response } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { MonthQuery, resolveMonth } from "../../utils/validation.utils";
import { buildAchievements } from "./achievements.service";
import { buildUpcoming } from "./cashflow.service";
import { dashboardService } from "./dashboard.service";
import { buildInsights } from "./insights.service";

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

  insights: asyncHandler(async (req: Request, res: Response) => {
    const { year, month } = resolveMonth((req.validated?.query ?? {}) as MonthQuery);
    res.json(await buildInsights(req.userId!, year, month));
  }),

  achievements: asyncHandler(async (req: Request, res: Response) => {
    const { year, month } = resolveMonth((req.validated?.query ?? {}) as MonthQuery);
    res.json(await buildAchievements(req.userId!, year, month));
  }),

  upcoming: asyncHandler(async (req: Request, res: Response) => {
    const raw = Number(req.query.days);
    const days = Number.isFinite(raw) ? Math.min(120, Math.max(7, Math.round(raw))) : 45;
    res.json(await buildUpcoming(req.userId!, days));
  }),
};
