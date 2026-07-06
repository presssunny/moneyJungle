import { Router } from "express";
import { gateAuth } from "../../middlewares/gateAuth.middleware";
import { validate } from "../../middlewares/validation.middleware";
import { idParamSchema } from "../../utils/validation.utils";
import { alertsController } from "./alerts.controller";

export const alertsRoutes = Router();

alertsRoutes.use(gateAuth);
alertsRoutes.get("/", alertsController.list);
alertsRoutes.patch("/read-all", alertsController.markAllRead);
alertsRoutes.patch("/:id/read", validate({ params: idParamSchema }), alertsController.markRead);
alertsRoutes.delete("/:id", validate({ params: idParamSchema }), alertsController.remove);
