import { Request, Response, Router } from "express";
import { gateAuth } from "../../middlewares/gateAuth.middleware";
import { validate } from "../../middlewares/validation.middleware";
import { asyncHandler } from "../../utils/asyncHandler";
import { IdParam, idParamSchema } from "../../utils/validation.utils";
import { paymentMethodsService } from "./paymentMethods.service";
import {
  CreatePaymentMethodBody,
  UpdatePaymentMethodBody,
  createPaymentMethodSchema,
  updatePaymentMethodSchema,
} from "./paymentMethods.validation";

export const paymentMethodsRoutes = Router();

paymentMethodsRoutes.use(gateAuth);

paymentMethodsRoutes.get(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await paymentMethodsService.list(req.userId!));
  })
);

paymentMethodsRoutes.post(
  "/",
  validate({ body: createPaymentMethodSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const body = req.validated?.body as CreatePaymentMethodBody;
    res.status(201).json(await paymentMethodsService.create(req.userId!, body));
  })
);

paymentMethodsRoutes.patch(
  "/:id",
  validate({ params: idParamSchema, body: updatePaymentMethodSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.validated?.params as IdParam;
    const body = req.validated?.body as UpdatePaymentMethodBody;
    res.json(await paymentMethodsService.update(req.userId!, id, body));
  })
);

paymentMethodsRoutes.delete(
  "/:id",
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.validated?.params as IdParam;
    await paymentMethodsService.remove(req.userId!, id);
    res.json({ ok: true });
  })
);
