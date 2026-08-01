import { Request, Response, Router } from "express";
import { gateAuth } from "../../middlewares/gateAuth.middleware";
import { validate } from "../../middlewares/validation.middleware";
import { asyncHandler } from "../../utils/asyncHandler";
import { IdParam, idParamSchema } from "../../utils/validation.utils";
import { savingsService } from "./savings.service";
import {
  CreateSavingsGoalBody,
  DepositBody,
  UpdateSavingsGoalBody,
  createSavingsGoalSchema,
  depositSchema,
  updateSavingsGoalSchema,
} from "./savings.validation";

export const savingsRoutes = Router();

savingsRoutes.use(gateAuth);

savingsRoutes.get(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await savingsService.list(req.userId!));
  })
);

savingsRoutes.post(
  "/",
  validate({ body: createSavingsGoalSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const body = req.validated?.body as CreateSavingsGoalBody;
    res.status(201).json(await savingsService.create(req.userId!, body));
  })
);

savingsRoutes.post(
  "/:id/deposit",
  validate({ params: idParamSchema, body: depositSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.validated?.params as IdParam;
    const { amount } = req.validated?.body as DepositBody;
    res.json(await savingsService.deposit(req.userId!, id, amount));
  })
);

savingsRoutes.patch(
  "/:id",
  validate({ params: idParamSchema, body: updateSavingsGoalSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.validated?.params as IdParam;
    const body = req.validated?.body as UpdateSavingsGoalBody;
    res.json(await savingsService.update(req.userId!, id, body));
  })
);

savingsRoutes.delete(
  "/:id",
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.validated?.params as IdParam;
    await savingsService.remove(req.userId!, id);
    res.json({ ok: true });
  })
);
