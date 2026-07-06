import { Router } from "express";
import { gateAuth } from "../../middlewares/gateAuth.middleware";
import { validate } from "../../middlewares/validation.middleware";
import { idParamSchema } from "../../utils/validation.utils";
import { expensesController } from "./expenses.controller";
import {
  createExpenseSchema,
  listExpensesQuerySchema,
  updateExpenseSchema,
} from "./expenses.validation";

export const expensesRoutes = Router();

expensesRoutes.use(gateAuth);
expensesRoutes.get("/", validate({ query: listExpensesQuerySchema }), expensesController.list);
expensesRoutes.post("/", validate({ body: createExpenseSchema }), expensesController.create);
expensesRoutes.patch(
  "/:id",
  validate({ params: idParamSchema, body: updateExpenseSchema }),
  expensesController.update
);
expensesRoutes.delete("/:id", validate({ params: idParamSchema }), expensesController.remove);
