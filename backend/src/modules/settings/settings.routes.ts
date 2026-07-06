import { Router } from "express";
import { gateAuth } from "../../middlewares/gateAuth.middleware";
import { validate } from "../../middlewares/validation.middleware";
import { settingsController } from "./settings.controller";
import { updateSettingsSchema } from "./settings.validation";

export const settingsRoutes = Router();

settingsRoutes.use(gateAuth);
settingsRoutes.get("/", settingsController.get);
settingsRoutes.patch("/", validate({ body: updateSettingsSchema }), settingsController.update);
