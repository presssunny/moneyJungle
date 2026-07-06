import { Router } from "express";
import { gateAuth } from "../../middlewares/gateAuth.middleware";
import { updatesController } from "./updates.controller";

export const updatesRoutes = Router();

updatesRoutes.use(gateAuth);
updatesRoutes.get("/ticker", updatesController.ticker);
