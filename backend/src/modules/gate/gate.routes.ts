import { Router } from "express";
import { gateAuth } from "../../middlewares/gateAuth.middleware";
import { validate } from "../../middlewares/validation.middleware";
import { gateController } from "./gate.controller";
import { loginSchema } from "./gate.validation";

export const gateRoutes = Router();

gateRoutes.post("/login", validate({ body: loginSchema }), gateController.login);
gateRoutes.post("/logout", gateAuth, gateController.logout);
gateRoutes.get("/session", gateAuth, gateController.session);
