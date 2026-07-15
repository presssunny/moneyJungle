import type { ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { ThemeProvider } from "../context/ThemeContext";
import { AppLayout } from "../layouts/AppLayout";
import AlertsPage from "../pages/AlertsPage";
import BankPage from "../pages/BankPage";
import BudgetsPage from "../pages/BudgetsPage";
import CalendarPage from "../pages/CalendarPage";
import CategoriesRulesPage from "../pages/CategoriesRulesPage";
import ComparisonPage from "../pages/ComparisonPage";
import CreditPage from "../pages/CreditPage";
import DashboardPage from "../pages/DashboardPage";
import ExpensesPage from "../pages/ExpensesPage";
import FamilyPage from "../pages/FamilyPage";
import GatePage from "../pages/GatePage";
import ImportsPage from "../pages/ImportsPage";
import IncomesPage from "../pages/IncomesPage";
import LoansPage from "../pages/LoansPage";
import PaymentMethodsPage from "../pages/PaymentMethodsPage";
import RecurringPage from "../pages/RecurringPage";
import ReportsPage from "../pages/ReportsPage";
import SavingsPage from "../pages/SavingsPage";
import SettingsPage from "../pages/SettingsPage";
import SubscriptionsPage from "../pages/SubscriptionsPage";
import { isLoggedIn } from "../services/gate.service";

function RequireGate({ children }: { children: ReactNode }) {
  if (!isLoggedIn()) return <Navigate to="/gate" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <ThemeProvider>
      <Routes>
        <Route path="/gate" element={<GatePage />} />
        <Route
          element={
            <RequireGate>
              <AppLayout />
            </RequireGate>
          }
        >
          <Route path="/" element={<DashboardPage />} />
          <Route path="/incomes" element={<IncomesPage />} />
          <Route path="/expenses" element={<ExpensesPage />} />
          <Route path="/budgets" element={<BudgetsPage />} />
          <Route path="/credit" element={<CreditPage />} />
          <Route path="/bank" element={<BankPage />} />
          <Route path="/recurring" element={<RecurringPage />} />
          <Route path="/subscriptions" element={<SubscriptionsPage />} />
          <Route path="/loans" element={<LoansPage />} />
          <Route path="/savings" element={<SavingsPage />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/comparison" element={<ComparisonPage />} />
          <Route path="/alerts" element={<AlertsPage />} />
          <Route path="/categories" element={<CategoriesRulesPage />} />
          <Route path="/payment-methods" element={<PaymentMethodsPage />} />
          <Route path="/family" element={<FamilyPage />} />
          <Route path="/imports" element={<ImportsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </ThemeProvider>
  );
}
