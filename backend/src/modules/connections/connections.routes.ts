import { Request, Response, Router } from "express";
import { gateAuth } from "../../middlewares/gateAuth.middleware";
import { validate } from "../../middlewares/validation.middleware";
import { asyncHandler } from "../../utils/asyncHandler";
import { IdParam, idParamSchema, validatedBody, validatedParams } from "../../utils/validation.utils";
import { connectionsService } from "./connections.service";
import { connectionSync } from "./connectionSync.service";
import { CreateConnectionBody, UpdateConnectionBody, createConnectionSchema, updateConnectionSchema } from "./connections.validation";

export const connectionsRoutes = Router();

connectionsRoutes.use(gateAuth);

connectionsRoutes.get(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    res.json({ providers: connectionsService.providers(), connections: await connectionsService.list(req.userId!) });
  })
);

connectionsRoutes.post(
  "/",
  validate({ body: createConnectionSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    res.status(201).json(await connectionsService.create(req.userId!, validatedBody<CreateConnectionBody>(req)));
  })
);

connectionsRoutes.get(
  "/:id",
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await connectionsService.get(req.userId!, validatedParams<IdParam>(req).id));
  })
);

connectionsRoutes.patch(
  "/:id",
  validate({ params: idParamSchema, body: updateConnectionSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = validatedParams<IdParam>(req);
    res.json(await connectionsService.update(req.userId!, id, validatedBody<UpdateConnectionBody>(req)));
  })
);

connectionsRoutes.delete(
  "/:id",
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    await connectionsService.remove(req.userId!, validatedParams<IdParam>(req).id);
    res.json({ ok: true });
  })
);

// Returns at once; the page polls GET /:id while the bank may wait on her phone.
connectionsRoutes.post(
  "/:id/sync",
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = validatedParams<IdParam>(req);
    await connectionSync.start(req.userId!, id);
    res.status(202).json(await connectionsService.get(req.userId!, id));
  })
);
