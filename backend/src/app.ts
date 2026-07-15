import cors from "cors";
import express from "express";
import { errorMiddleware, notFoundMiddleware } from "./middlewares/error.middleware";
import { alertsRoutes } from "./modules/alerts/alerts.routes";
import { bankRoutes } from "./modules/bank/bank.routes";
import { budgetsRoutes } from "./modules/budgets/budgets.routes";
import { categoriesRoutes } from "./modules/categories/categories.routes";
import { creditRoutes } from "./modules/credit/credit.routes";
import { dashboardRoutes } from "./modules/dashboard/dashboard.routes";
import { expensesRoutes } from "./modules/expenses/expenses.routes";
import { familyRoutes } from "./modules/family/family.routes";
import { gateRoutes } from "./modules/gate/gate.routes";
import { importsRoutes } from "./modules/imports/imports.routes";
import { incomesRoutes } from "./modules/incomes/incomes.routes";
import { loansRoutes } from "./modules/loans/loans.routes";
import { paymentMethodsRoutes } from "./modules/paymentMethods/paymentMethods.routes";
import { recurringRoutes } from "./modules/recurring/recurring.routes";
import { remindersRoutes } from "./modules/reminders/reminders.routes";
import { reportsRoutes } from "./modules/reports/reports.routes";
import { savingsRoutes } from "./modules/savings/savings.routes";
import { settingsRoutes } from "./modules/settings/settings.routes";
import { subscriptionsRoutes } from "./modules/subscriptions/subscriptions.routes";
import { updatesRoutes } from "./modules/updates/updates.routes";

const app = express();

app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "monthly-finance-planner" });
});

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
app.use("/api/family", familyRoutes);
app.use("/api/imports", importsRoutes);

app.use("/api", notFoundMiddleware);
app.use(errorMiddleware);

export default app;
