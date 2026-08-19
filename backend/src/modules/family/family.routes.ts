import { Request, Response, Router } from "express";
import { gateAuth } from "../../middlewares/gateAuth.middleware";
import { validate } from "../../middlewares/validation.middleware";
import { asyncHandler } from "../../utils/asyncHandler";
import { IdParam, idParamSchema, validatedBody, validatedParams } from "../../utils/validation.utils";
import { familyService } from "./family.service";
import {
  CreateFamilyMemberBody,
  UpdateFamilyMemberBody,
  createFamilyMemberSchema,
  updateFamilyMemberSchema,
} from "./family.validation";

export const familyRoutes = Router();

familyRoutes.use(gateAuth);

familyRoutes.get(
  "/",
  asyncHandler(async (_req: Request, res: Response) => {
    res.json(await familyService.list());
  })
);

familyRoutes.post(
  "/",
  validate({ body: createFamilyMemberSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const body = validatedBody<CreateFamilyMemberBody>(req);
    res.status(201).json(await familyService.create(body));
  })
);

familyRoutes.patch(
  "/:id",
  validate({ params: idParamSchema, body: updateFamilyMemberSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = validatedParams<IdParam>(req);
    const body = validatedBody<UpdateFamilyMemberBody>(req);
    res.json(await familyService.update(id, body));
  })
);

familyRoutes.delete(
  "/:id",
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = validatedParams<IdParam>(req);
    await familyService.remove(id, req.userId!);
    res.json({ ok: true });
  })
);
