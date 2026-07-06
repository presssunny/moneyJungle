import { Router } from "express";
import { gateAuth } from "../../middlewares/gateAuth.middleware";
import { validate } from "../../middlewares/validation.middleware";
import { monthQuerySchema } from "../../utils/validation.utils";
import { dashboardController } from "./dashboard.controller";

export const dashboardRoutes = Router();

dashboardRoutes.use(gateAuth);
dashboardRoutes.get("/summary", validate({ query: monthQuerySchema }), dashboardController.summary);
dashboardRoutes.get("/charts", validate({ query: monthQuerySchema }), dashboardController.charts);
dashboardRoutes.get("/recent-transactions", dashboardController.recent);
