import { Request, Response, Router } from "express";
import { gateAuth } from "../../middlewares/gateAuth.middleware";
import { validate } from "../../middlewares/validation.middleware";
import { asyncHandler } from "../../utils/asyncHandler";
import { IdParam, idParamSchema, validatedBody, validatedParams } from "../../utils/validation.utils";
import { recurringService } from "./recurring.service";
import {
  CreateRecurringBody,
  GenerateBody,
  UpdateRecurringBody,
  createRecurringSchema,
  generateSchema,
  updateRecurringSchema,
} from "./recurring.validation";

export const recurringRoutes = Router();

recurringRoutes.use(gateAuth);

recurringRoutes.get(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await recurringService.list(req.userId!));
  })
);

recurringRoutes.post(
  "/",
  validate({ body: createRecurringSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const body = validatedBody<CreateRecurringBody>(req);
    res.status(201).json(await recurringService.create(req.userId!, body));
  })
);

recurringRoutes.post(
  "/generate",
  validate({ body: generateSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { year, month } = validatedBody<GenerateBody>(req);
    res.json(await recurringService.generate(req.userId!, year, month));
  })
);

recurringRoutes.patch(
  "/:id",
  validate({ params: idParamSchema, body: updateRecurringSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = validatedParams<IdParam>(req);
    const body = validatedBody<UpdateRecurringBody>(req);
    res.json(await recurringService.update(req.userId!, id, body));
  })
);

recurringRoutes.delete(
  "/:id",
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = validatedParams<IdParam>(req);
    await recurringService.remove(req.userId!, id);
    res.json({ ok: true });
  })
);
