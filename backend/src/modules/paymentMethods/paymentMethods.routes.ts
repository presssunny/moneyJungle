import { Request, Response, Router } from "express";
import { gateAuth } from "../../middlewares/gateAuth.middleware";
import { validate } from "../../middlewares/validation.middleware";
import { asyncHandler } from "../../utils/asyncHandler";
import { IdParam, idParamSchema, validatedBody, validatedParams } from "../../utils/validation.utils";
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
    const body = validatedBody<CreatePaymentMethodBody>(req);
    res.status(201).json(await paymentMethodsService.create(req.userId!, body));
  })
);

paymentMethodsRoutes.patch(
  "/:id",
  validate({ params: idParamSchema, body: updatePaymentMethodSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = validatedParams<IdParam>(req);
    const body = validatedBody<UpdatePaymentMethodBody>(req);
    res.json(await paymentMethodsService.update(req.userId!, id, body));
  })
);

paymentMethodsRoutes.delete(
  "/:id",
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = validatedParams<IdParam>(req);
    await paymentMethodsService.remove(req.userId!, id);
    res.json({ ok: true });
  })
);
