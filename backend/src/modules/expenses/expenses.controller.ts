import { Request, Response } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { IdParam, resolveMonth } from "../../utils/validation.utils";
import { expensesService } from "./expenses.service";
import { quickAddService } from "./quickAdd.service";
import { CreateExpenseBody, ListExpensesQuery, QuickAddBody, UpdateExpenseBody } from "./expenses.validation";

export const expensesController = {
  list: asyncHandler(async (req: Request, res: Response) => {
    const query = (req.validated?.query ?? {}) as ListExpensesQuery;
    const { year, month } = resolveMonth(query);
    res.json(await expensesService.list(req.userId!, year, month, query.categoryId));
  }),

  create: asyncHandler(async (req: Request, res: Response) => {
    const body = req.validated?.body as CreateExpenseBody;
    res.status(201).json(await expensesService.create(req.userId!, body));
  }),

  quickAdd: asyncHandler(async (req: Request, res: Response) => {
    const { text } = req.validated?.body as QuickAddBody;
    res.status(201).json(await quickAddService.add(req.userId!, text));
  }),

  update: asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.validated?.params as IdParam;
    const body = req.validated?.body as UpdateExpenseBody;
    res.json(await expensesService.update(req.userId!, id, body));
  }),

  remove: asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.validated?.params as IdParam;
    await expensesService.remove(req.userId!, id);
    res.json({ ok: true });
  }),
};
