import type { ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { ThemeProvider } from "../context/ThemeContext";
import { AppLayout } from "../layouts/AppLayout";
import BudgetsPage from "../pages/BudgetsPage";
import CategoriesRulesPage from "../pages/CategoriesRulesPage";
import ComingSoonPage from "../pages/ComingSoonPage";
import CreditPage from "../pages/CreditPage";
import DashboardPage from "../pages/DashboardPage";
import ExpensesPage from "../pages/ExpensesPage";
import GatePage from "../pages/GatePage";
import IncomesPage from "../pages/IncomesPage";
import LoansPage from "../pages/LoansPage";
import ReportsPage from "../pages/ReportsPage";
import SettingsPage from "../pages/SettingsPage";
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
          <Route path="/bank" element={<ComingSoonPage title="בנק / חשבונות" />} />
          <Route path="/recurring" element={<ComingSoonPage title="תשלומים קבועים" />} />
          <Route path="/subscriptions" element={<ComingSoonPage title="מנויים" />} />
          <Route path="/loans" element={<LoansPage />} />
          <Route path="/savings" element={<ComingSoonPage title="חיסכון ויעדים" />} />
          <Route path="/calendar" element={<ComingSoonPage title="לוח שנה פיננסי" />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/comparison" element={<ComingSoonPage title="השוואת חודשים" />} />
          <Route path="/alerts" element={<ComingSoonPage title="התראות וחריגות" />} />
          <Route path="/categories" element={<CategoriesRulesPage />} />
          <Route path="/payment-methods" element={<ComingSoonPage title="אמצעי תשלום" />} />
          <Route path="/family" element={<ComingSoonPage title="משפחה / משתמשים" />} />
          <Route path="/imports" element={<ComingSoonPage title="ייבוא קבצים" />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </ThemeProvider>
  );
}
