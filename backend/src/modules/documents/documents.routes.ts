import { Request, Response, Router } from "express";
import { gateAuth } from "../../middlewares/gateAuth.middleware";
import { validate } from "../../middlewares/validation.middleware";
import { asyncHandler } from "../../utils/asyncHandler";
import { IdParam, idParamSchema } from "../../utils/validation.utils";
import { documentsService } from "./documents.service";

export const documentsRoutes = Router();

documentsRoutes.use(gateAuth);

/** Every file ever uploaded, newest first, with what came of it. */
documentsRoutes.get(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await documentsService.list(req.userId!));
  })
);

/** Removes the LOG ENTRY only — the imported transactions stay. */
documentsRoutes.delete(
  "/:id",
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.validated?.params as IdParam;
    await documentsService.remove(req.userId!, id);
    res.json({ ok: true });
  })
);
