import { lazy, Suspense, type ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { Loading } from "../components/common/Loading";
import { ThemeProvider } from "../context/ThemeContext";
import { AppLayout } from "../layouts/AppLayout";
import LoginPage from "../pages/LoginPage";
import { isLoggedIn } from "../services/gate.service";
import { RequireOnboarding } from "./RequireOnboarding";

// Route-level code splitting: each page is its own chunk, fetched on first
// visit instead of bundled into the initial load. LoginPage stays eager —
// it's the one page every visitor loads before there is anything to split.
const AccountsPage = lazy(() => import("../pages/AccountsPage"));
const AlertsPage = lazy(() => import("../pages/AlertsPage"));
const BankPage = lazy(() => import("../pages/BankPage"));
const BudgetsPage = lazy(() => import("../pages/BudgetsPage"));
const CalendarPage = lazy(() => import("../pages/CalendarPage"));
const CategoriesRulesPage = lazy(() => import("../pages/CategoriesRulesPage"));
const ComparisonPage = lazy(() => import("../pages/ComparisonPage"));
const CreditPage = lazy(() => import("../pages/CreditPage"));
const DashboardPage = lazy(() => import("../pages/DashboardPage"));
const DocumentsPage = lazy(() => import("../pages/DocumentsPage"));
const ExpensesPage = lazy(() => import("../pages/ExpensesPage"));
const FamilyPage = lazy(() => import("../pages/FamilyPage"));
const ImportsPage = lazy(() => import("../pages/ImportsPage"));
const IncomesPage = lazy(() => import("../pages/IncomesPage"));
const LoansPage = lazy(() => import("../pages/LoansPage"));
const ManagePage = lazy(() => import("../pages/ManagePage"));
const OnboardingPage = lazy(() => import("../pages/OnboardingPage"));
const PaymentMethodsPage = lazy(() => import("../pages/PaymentMethodsPage"));
const RecurringPage = lazy(() => import("../pages/RecurringPage"));
const ReportsHubPage = lazy(() => import("../pages/ReportsHubPage"));
const SavingsPage = lazy(() => import("../pages/SavingsPage"));
const SettingsPage = lazy(() => import("../pages/SettingsPage"));
const SubscriptionsPage = lazy(() => import("../pages/SubscriptionsPage"));
const TransactionsPage = lazy(() => import("../pages/TransactionsPage"));

/** Every route below the login screen is behind this. */
function RequireGate({ children }: { children: ReactNode }) {
  if (!isLoggedIn()) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <ThemeProvider>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          {/* Old entry point — kept so existing bookmarks and links still land. */}
          <Route path="/gate" element={<Navigate to="/login" replace />} />
          <Route
            path="/onboarding"
            element={
              <RequireGate>
                <OnboardingPage />
              </RequireGate>
            }
          />
          <Route
            element={
              <RequireGate>
                <RequireOnboarding>
                  <AppLayout />
                </RequireOnboarding>
              </RequireGate>
            }
          >
            {/* Primary destinations */}
            <Route path="/" element={<DashboardPage />} />
            <Route path="/transactions" element={<TransactionsPage />} />
            <Route path="/budgets" element={<BudgetsPage />} />
            <Route path="/accounts" element={<AccountsPage />} />
            <Route path="/reports" element={<ReportsHubPage />} />
            <Route path="/manage" element={<ManagePage />} />

            {/* Legacy standalone routes — kept for deep links / bookmarks */}
            <Route path="/incomes" element={<IncomesPage />} />
            <Route path="/expenses" element={<ExpensesPage />} />
            <Route path="/credit" element={<CreditPage />} />
            <Route path="/bank" element={<BankPage />} />
            <Route path="/recurring" element={<RecurringPage />} />
            <Route path="/subscriptions" element={<SubscriptionsPage />} />
            <Route path="/loans" element={<LoansPage />} />
            <Route path="/savings" element={<SavingsPage />} />
            <Route path="/calendar" element={<CalendarPage />} />
            <Route path="/comparison" element={<ComparisonPage />} />
            <Route path="/alerts" element={<AlertsPage />} />
            <Route path="/categories" element={<CategoriesRulesPage />} />
            <Route path="/payment-methods" element={<PaymentMethodsPage />} />
            <Route path="/family" element={<FamilyPage />} />
            <Route path="/documents" element={<DocumentsPage />} />
            <Route path="/imports" element={<ImportsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </Suspense>
    </ThemeProvider>
  );
}
