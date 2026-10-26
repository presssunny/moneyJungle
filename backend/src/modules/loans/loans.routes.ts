import { Router } from "express";
import { gateAuth } from "../../middlewares/gateAuth.middleware";
import { SPREADSHEET_KINDS, uploadFile } from "../../middlewares/upload.middleware";
import { validate } from "../../middlewares/validation.middleware";
import { idParamSchema } from "../../utils/validation.utils";
import { loansController } from "./loans.controller";
import { closeLoanSchema, createLoanSchema, updateLoanSchema } from "./loans.validation";

export const loansRoutes = Router();

loansRoutes.use(gateAuth);
loansRoutes.get("/", loansController.list);
loansRoutes.post("/", validate({ body: createLoanSchema }), loansController.create);

/** Upload the bank's amortisation table; it becomes the loan's source of truth. */
loansRoutes.post("/schedule/import", ...uploadFile(SPREADSHEET_KINDS), loansController.importSchedule);

loansRoutes.get("/:id/schedule", validate({ params: idParamSchema }), loansController.schedule);
loansRoutes.get(
  "/:id/early-repayment",
  validate({ params: idParamSchema }),
  loansController.earlyRepayment
);
loansRoutes.post(
  "/:id/close",
  validate({ params: idParamSchema, body: closeLoanSchema }),
  loansController.close
);
loansRoutes.patch(
  "/:id",
  validate({ params: idParamSchema, body: updateLoanSchema }),
  loansController.update
);
loansRoutes.delete("/:id", validate({ params: idParamSchema }), loansController.remove);
