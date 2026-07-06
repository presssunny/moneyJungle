import { Router } from "express";
import { gateAuth } from "../../middlewares/gateAuth.middleware";
import { validate } from "../../middlewares/validation.middleware";
import { idParamSchema } from "../../utils/validation.utils";
import { categoriesController } from "./categories.controller";
import {
  createCategorySchema,
  createRuleSchema,
  updateCategorySchema,
  updateRuleSchema,
} from "./categories.validation";

export const categoriesRoutes = Router();

categoriesRoutes.use(gateAuth);

// Auto-categorization rules (must come before /:id routes)
categoriesRoutes.get("/rules", categoriesController.listRules);
categoriesRoutes.post("/rules", validate({ body: createRuleSchema }), categoriesController.createRule);
categoriesRoutes.patch(
  "/rules/:id",
  validate({ params: idParamSchema, body: updateRuleSchema }),
  categoriesController.updateRule
);
categoriesRoutes.delete(
  "/rules/:id",
  validate({ params: idParamSchema }),
  categoriesController.removeRule
);

categoriesRoutes.get("/", categoriesController.list);
categoriesRoutes.post("/", validate({ body: createCategorySchema }), categoriesController.create);
categoriesRoutes.patch(
  "/:id",
  validate({ params: idParamSchema, body: updateCategorySchema }),
  categoriesController.update
);
categoriesRoutes.delete("/:id", validate({ params: idParamSchema }), categoriesController.remove);
