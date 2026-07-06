import { Router } from "express";
import { gateAuth } from "../../middlewares/gateAuth.middleware";
import { validate } from "../../middlewares/validation.middleware";
import { idParamSchema } from "../../utils/validation.utils";
import { loansController } from "./loans.controller";
import { createLoanSchema, updateLoanSchema } from "./loans.validation";

export const loansRoutes = Router();

loansRoutes.use(gateAuth);
loansRoutes.get("/", loansController.list);
loansRoutes.post("/", validate({ body: createLoanSchema }), loansController.create);
loansRoutes.get("/:id/schedule", validate({ params: idParamSchema }), loansController.schedule);
loansRoutes.patch(
  "/:id",
  validate({ params: idParamSchema, body: updateLoanSchema }),
  loansController.update
);
loansRoutes.delete("/:id", validate({ params: idParamSchema }), loansController.remove);
