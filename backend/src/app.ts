import { journeyRoutes } from "./modules/journey/journey.routes";
import { householdAssistantRoutes } from "./modules/householdAssistant/householdAssistant.routes";
import { importSessionRoutes } from "./modules/imports/importSession.routes";
import cors from "cors";
import express from "express";
import { env } from "./config/env";
import { allowedOrigin, checkOrigin } from "./middlewares/origin.middleware";
import { errorMiddleware, notFoundMiddleware } from "./middlewares/error.middleware";
import { rateLimit } from "./middlewares/rateLimit.middleware";
import { securityHeaders } from "./middlewares/securityHeaders.middleware";
import { alertsRoutes } from "./modules/alerts/alerts.routes";
import { bankRoutes } from "./modules/bank/bank.routes";
import { budgetsRoutes } from "./modules/budgets/budgets.routes";
import { categoriesRoutes } from "./modules/categories/categories.routes";
import { creditRoutes } from "./modules/credit/credit.routes";
import { crmRoutes } from "./modules/crm/crm.routes";
import { dashboardRoutes } from "./modules/dashboard/dashboard.routes";
import { expensesRoutes } from "./modules/expenses/expenses.routes";
import { familyRoutes } from "./modules/family/family.routes";
import { gateRoutes } from "./modules/gate/gate.routes";
import { documentsRoutes } from "./modules/documents/documents.routes";
import { importsRoutes } from "./modules/imports/imports.routes";
import { incomesRoutes } from "./modules/incomes/incomes.routes";
import { loansRoutes } from "./modules/loans/loans.routes";
import { paymentMethodsRoutes } from "./modules/paymentMethods/paymentMethods.routes";
import { assetsRoutes } from "./modules/assets/assets.routes";
import { recurringRoutes } from "./modules/recurring/recurring.routes";
import { remindersRoutes } from "./modules/reminders/reminders.routes";
import { reportsRoutes } from "./modules/reports/reports.routes";
import { savingsRoutes } from "./modules/savings/savings.routes";
import { settingsRoutes } from "./modules/settings/settings.routes";
import { subscriptionsRoutes } from "./modules/subscriptions/subscriptions.routes";
import { updatesRoutes } from "./modules/updates/updates.routes";

const app = express();

// Trust the reverse-proxy hop so req.ip reflects the real client (rate limiting).
app.set("trust proxy", env.TRUST_PROXY === "loopback" ? "loopback" : false);

// CORS: restrict to an explicit allow-list when CORS_ORIGIN is set, else allow all (dev).
app.use(cors({ origin: (origin, callback) => callback(null, !origin || allowedOrigin(origin)), credentials: true }));

app.use(securityHeaders);
app.use("/api", checkOrigin);
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "monthly-finance-planner" });
});

// Throttle gate login to slow brute-force against the shared password.
app.use("/api/gate/login", rateLimit({ windowMs: 15 * 60 * 1000, max: 10 }));

app.use("/api/gate", gateRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/updates", updatesRoutes);
app.use("/api/reminders", remindersRoutes);
app.use("/api/alerts", alertsRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/categories", categoriesRoutes);
app.use("/api/payment-methods", paymentMethodsRoutes);
app.use("/api/incomes", incomesRoutes);
app.use("/api/expenses", expensesRoutes);
app.use("/api/budgets", budgetsRoutes);
app.use("/api/loans", loansRoutes);
app.use("/api/credit", creditRoutes);
app.use("/api/reports", reportsRoutes);
app.use("/api/bank", bankRoutes);
app.use("/api/recurring", recurringRoutes);
app.use("/api/subscriptions", subscriptionsRoutes);
app.use("/api/savings", savingsRoutes);
app.use("/api/assets", assetsRoutes);
app.use("/api/family", familyRoutes);
app.use("/api/journey", journeyRoutes);
app.use("/api/household-assistant", householdAssistantRoutes);
app.use("/api/imports/sessions", importSessionRoutes);
app.use("/api/imports", importsRoutes);
app.use("/api/documents", documentsRoutes);
// The CRM's own namespace — read-only aggregation across every domain above,
// plus customer create/update/delete delegated to familyService. Kept
// separate from the customer-facing routes on purpose (see crm.routes.ts).
app.use("/api/crm", crmRoutes);

app.use("/api", notFoundMiddleware);
app.use(errorMiddleware);

export default app;
