import { Request, Response, Router } from "express";
import { gateAuth } from "../../middlewares/gateAuth.middleware";
import { validate } from "../../middlewares/validation.middleware";
import { asyncHandler } from "../../utils/asyncHandler";
import { IdParam, idParamSchema, validatedBody, validatedParams } from "../../utils/validation.utils";
import { assetsService } from "./assets.service";
import { CreateAssetBody, UpdateAssetBody, createAssetSchema, updateAssetSchema } from "./assets.validation";

export const assetsRoutes = Router();

assetsRoutes.use(gateAuth);

assetsRoutes.get(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await assetsService.list(req.userId!));
  })
);

assetsRoutes.post(
  "/",
  validate({ body: createAssetSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const body = validatedBody<CreateAssetBody>(req);
    res.status(201).json(await assetsService.create(req.userId!, body));
  })
);

assetsRoutes.patch(
  "/:id",
  validate({ params: idParamSchema, body: updateAssetSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = validatedParams<IdParam>(req);
    const body = validatedBody<UpdateAssetBody>(req);
    res.json(await assetsService.update(req.userId!, id, body));
  })
);

assetsRoutes.delete(
  "/:id",
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = validatedParams<IdParam>(req);
    await assetsService.remove(req.userId!, id);
    res.json({ ok: true });
  })
);
