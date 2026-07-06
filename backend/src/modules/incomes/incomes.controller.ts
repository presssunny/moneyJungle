import { Request, Response } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { IdParam, MonthQuery, resolveMonth } from "../../utils/validation.utils";
import { incomesService } from "./incomes.service";
import { CreateIncomeBody, UpdateIncomeBody } from "./incomes.validation";

export const incomesController = {
  list: asyncHandler(async (req: Request, res: Response) => {
    const { year, month } = resolveMonth((req.validated?.query ?? {}) as MonthQuery);
    res.json(await incomesService.list(req.userId!, year, month));
  }),

  create: asyncHandler(async (req: Request, res: Response) => {
    const body = req.validated?.body as CreateIncomeBody;
    res.status(201).json(await incomesService.create(req.userId!, body));
  }),

  update: asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.validated?.params as IdParam;
    const body = req.validated?.body as UpdateIncomeBody;
    res.json(await incomesService.update(req.userId!, id, body));
  }),

  remove: asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.validated?.params as IdParam;
    await incomesService.remove(req.userId!, id);
    res.json({ ok: true });
  }),
};
