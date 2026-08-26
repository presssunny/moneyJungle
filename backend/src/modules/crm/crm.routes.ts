import { Router } from "express";
import { gateAuth } from "../../middlewares/gateAuth.middleware";
import { requireRole } from "../../middlewares/requireRole.middleware";
import { validate } from "../../middlewares/validation.middleware";
import { idParamSchema } from "../../utils/validation.utils";
import { crmController } from "./crm.controller";
import { createCustomerSchema, updateCustomerSchema } from "./crm.validation";

/**
 * The CRM's own route namespace, deliberately separate from every
 * customer-facing route in app.ts (/api/incomes, /api/expenses, ...). Same
 * gateAuth as the rest of the app — there is no second login system.
 *
 * RBAC, enforced here in the Backend (not just hidden in the Frontend):
 *  - ADMIN and VIEWER may reach every route in this file (read access).
 *  - Only ADMIN may reach the mutating routes (create/update) — VIEWER gets
 *    a 403 from requireRole before crmController/crmService ever runs.
 *  - A plain USER account is rejected by requireRole on every route here —
 *    the CRM does not exist for them at all, at the Backend level.
 *
 * A "customer" here IS a `users` row — the app has no separate Customer
 * entity (see crm.repository.ts). There is no DELETE route: removing an
 * account would cascade-delete its entire financial history (every domain
 * table has `onDelete: Cascade` on its `user` relation) — "manage account
 * status" (PATCH .../status via the general update route) is the supported
 * way to disable an account, deliberately, instead.
 */
export const crmRoutes = Router();

crmRoutes.use(gateAuth);
crmRoutes.use(requireRole("ADMIN", "VIEWER"));

crmRoutes.get("/customers", crmController.listCustomers);

crmRoutes.get("/customers/:id", validate({ params: idParamSchema }), crmController.getCustomer);

crmRoutes.post(
  "/customers",
  requireRole("ADMIN"),
  validate({ body: createCustomerSchema }),
  crmController.createCustomer
);

crmRoutes.patch(
  "/customers/:id",
  requireRole("ADMIN"),
  validate({ params: idParamSchema, body: updateCustomerSchema }),
  crmController.updateCustomer
);
