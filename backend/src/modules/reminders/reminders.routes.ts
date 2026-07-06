import { Router } from "express";
import { gateAuth } from "../../middlewares/gateAuth.middleware";
import { validate } from "../../middlewares/validation.middleware";
import { idParamSchema } from "../../utils/validation.utils";
import { remindersController } from "./reminders.controller";
import { createReminderSchema, updateReminderSchema } from "./reminders.validation";

export const remindersRoutes = Router();

remindersRoutes.use(gateAuth);
remindersRoutes.get("/", remindersController.list);
remindersRoutes.post("/", validate({ body: createReminderSchema }), remindersController.create);
remindersRoutes.patch(
  "/:id",
  validate({ params: idParamSchema, body: updateReminderSchema }),
  remindersController.update
);
remindersRoutes.delete("/:id", validate({ params: idParamSchema }), remindersController.remove);
