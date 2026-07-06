import { Request, Response, Router } from "express";
import { gateAuth } from "../../middlewares/gateAuth.middleware";
import { validate } from "../../middlewares/validation.middleware";
import { asyncHandler } from "../../utils/asyncHandler";
import { IdParam, MonthQuery, idParamSchema, monthQuerySchema, resolveMonth } from "../../utils/validation.utils";
import { budgetsService } from "./budgets.service";
import {
  CopyBudgetsBody,
  UpsertBudgetBody,
  copyBudgetsSchema,
  upsertBudgetSchema,
} from "./budgets.validation";

export const budgetsRoutes = Router();

budgetsRoutes.use(gateAuth);

budgetsRoutes.get(
  "/",
  validate({ query: monthQuerySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { year, month } = resolveMonth((req.validated?.query ?? {}) as MonthQuery);
    res.json(await budgetsService.list(req.userId!, year, month));
  })
);

budgetsRoutes.put(
  "/",
  validate({ body: upsertBudgetSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const body = req.validated?.body as UpsertBudgetBody;
    res.json(await budgetsService.upsert(req.userId!, body));
  })
);

budgetsRoutes.post(
  "/copy-previous",
  validate({ body: copyBudgetsSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const body = req.validated?.body as CopyBudgetsBody;
    res.json(await budgetsService.copyFromPrevious(req.userId!, body));
  })
);

budgetsRoutes.delete(
  "/:id",
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.validated?.params as IdParam;
    await budgetsService.remove(req.userId!, id);
    res.json({ ok: true });
  })
);
