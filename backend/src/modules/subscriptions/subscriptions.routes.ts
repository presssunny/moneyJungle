import { Request, Response, Router } from "express";
import { gateAuth } from "../../middlewares/gateAuth.middleware";
import { validate } from "../../middlewares/validation.middleware";
import { asyncHandler } from "../../utils/asyncHandler";
import { IdParam, idParamSchema } from "../../utils/validation.utils";
import { subscriptionsService } from "./subscriptions.service";
import {
  CreateSubscriptionBody,
  UpdateSubscriptionBody,
  createSubscriptionSchema,
  updateSubscriptionSchema,
} from "./subscriptions.validation";

export const subscriptionsRoutes = Router();

subscriptionsRoutes.use(gateAuth);

subscriptionsRoutes.get(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await subscriptionsService.list(req.userId!));
  })
);

subscriptionsRoutes.get(
  "/candidates",
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await subscriptionsService.detectCandidates(req.userId!));
  })
);

subscriptionsRoutes.post(
  "/",
  validate({ body: createSubscriptionSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const body = req.validated?.body as CreateSubscriptionBody;
    res.status(201).json(await subscriptionsService.create(req.userId!, body));
  })
);

subscriptionsRoutes.patch(
  "/:id",
  validate({ params: idParamSchema, body: updateSubscriptionSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.validated?.params as IdParam;
    const body = req.validated?.body as UpdateSubscriptionBody;
    res.json(await subscriptionsService.update(req.userId!, id, body));
  })
);

subscriptionsRoutes.delete(
  "/:id",
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.validated?.params as IdParam;
    await subscriptionsService.remove(req.userId!, id);
    res.json({ ok: true });
  })
);
