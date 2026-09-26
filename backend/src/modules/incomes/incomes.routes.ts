import { Router } from "express";
import { gateAuth } from "../../middlewares/gateAuth.middleware";
import { validate } from "../../middlewares/validation.middleware";
import { idParamSchema, monthQuerySchema } from "../../utils/validation.utils";
import { incomesController } from "./incomes.controller";
import { createIncomeSchema, updateIncomeSchema, incomeLedgerQuerySchema } from "./incomes.validation";

export const incomesRoutes = Router();

incomesRoutes.use(gateAuth);
incomesRoutes.get("/", validate({ query: monthQuerySchema }), incomesController.list);
incomesRoutes.get("/ledger", validate({ query: incomeLedgerQuerySchema }), incomesController.ledger);
incomesRoutes.post("/", validate({ body: createIncomeSchema }), incomesController.create);
incomesRoutes.patch(
  "/:id",
  validate({ params: idParamSchema, body: updateIncomeSchema }),
  incomesController.update
);
incomesRoutes.delete("/:id", validate({ params: idParamSchema }), incomesController.remove);
