import { Request, Response, Router } from "express";
import { gateAuth } from "../../middlewares/gateAuth.middleware";
import { validate } from "../../middlewares/validation.middleware";
import { asyncHandler } from "../../utils/asyncHandler";
import { MonthQuery, monthQuerySchema, resolveMonth } from "../../utils/validation.utils";
import { reportsService } from "./reports.service";
import { z } from "zod";
import { getForecast } from "./forecast.service";
import { validatedQuery } from "../../utils/validation.utils";

export const reportsRoutes = Router();

reportsRoutes.use(gateAuth);

const forecastQuery = z.object({
  monthlyIncomeChange: z.coerce.number().min(-1000000).max(1000000).default(0),
  monthlyExpenseChange: z.coerce.number().min(-1000000).max(1000000).default(0),
  oneTimeExpense: z.coerce.number().min(0).max(10000000).default(0),
  oneTimeMonth: z.coerce.number().int().min(1).max(12).default(1),
  excludedMonths: z.string().max(95).regex(/^(?:\d{4}-\d{2}(?:,\d{4}-\d{2})*)?$/).default(""),
});
reportsRoutes.get("/forecast", validate({ query: forecastQuery }), asyncHandler(async (req, res) => {
  const { excludedMonths, ...scenario } = validatedQuery<z.infer<typeof forecastQuery>>(req);
  res.json(await getForecast(req.userId!, scenario, excludedMonths.split(",").filter(Boolean)));
}));

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
