import { Request, Response } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { IdParam, resolveMonth, validatedBody, validatedParams } from "../../utils/validation.utils";
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
    const body = validatedBody<CreateExpenseBody>(req);
    res.status(201).json(await expensesService.create(req.userId!, body));
  }),

  quickAdd: asyncHandler(async (req: Request, res: Response) => {
    const { text } = validatedBody<QuickAddBody>(req);
    res.status(201).json(await quickAddService.add(req.userId!, text));
  }),

  update: asyncHandler(async (req: Request, res: Response) => {
    const { id } = validatedParams<IdParam>(req);
    const body = validatedBody<UpdateExpenseBody>(req);
    res.json(await expensesService.update(req.userId!, id, body));
  }),

  remove: asyncHandler(async (req: Request, res: Response) => {
    const { id } = validatedParams<IdParam>(req);
    await expensesService.remove(req.userId!, id);
    res.json({ ok: true });
  }),
};
