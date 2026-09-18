import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { Loading } from "../components/common/Loading";
import { ThemeProvider } from "../context/ThemeContext";
import { CrmLayout } from "../crm/CrmLayout";
import { AppLayout } from "../layouts/AppLayout";
import LoginPage from "../pages/LoginPage";
import { checkSession, currentUser, isLoggedIn } from "../services/gate.service";
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
const CrmCustomersPage = lazy(() => import("../crm/pages/CrmCustomersPage"));
const CrmCustomerDetailPage = lazy(() => import("../crm/pages/CrmCustomerDetailPage"));
const DashboardPage = lazy(() => import("../pages/DashboardPage"));
const DocumentsPage = lazy(() => import("../pages/DocumentsPage"));
const ExpensesPage = lazy(() => import("../pages/ExpensesPage"));
const FamilyPage = lazy(() => import("../pages/FamilyPage"));
const ImportJourneyPage = lazy(() => import("../pages/ImportJourneyPage"));
const FinancialDataPage = lazy(() => import("../pages/FinancialDataPage"));
const ReviewPage = lazy(() => import("../pages/ReviewPage"));
const CheckInPage = lazy(() => import("../pages/CheckInPage"));
const CommitmentsPage = lazy(() => import("../pages/CommitmentsPage"));
const SettingsHubPage = lazy(() => import("../pages/SettingsHubPage"));
const IncomesPage = lazy(() => import("../pages/IncomesPage"));
const LoansPage = lazy(() => import("../pages/LoansPage"));
const ManagePage = lazy(() => import("../pages/ManagePage"));
const OnboardingPage = lazy(() => import("../pages/OnboardingPage"));
const PaymentMethodsPage = lazy(() => import("../pages/PaymentMethodsPage"));
const RecurringPage = lazy(() => import("../pages/RecurringPage"));
const ReportsHubPage = lazy(() => import("../pages/ReportsHubPage"));
const SavingsPage = lazy(() => import("../pages/SavingsPage"));
const SubscriptionsPage = lazy(() => import("../pages/SubscriptionsPage"));
const TransactionsPage = lazy(() => import("../pages/TransactionsPage"));

/** Every route below the login screen is behind this. */
function RequireGate({ children }: { children: ReactNode }) {
  if (!isLoggedIn()) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

/**
 * Frontend-side gate for the CRM: hides it from a plain USER account. This is
 * UX only — the real enforcement is `requireRole("ADMIN", "VIEWER")` on the
 * Backend routes (see crm.routes.ts); a USER who somehow lands here still
 * gets 403s from every /api/crm/* call, this just avoids showing them a
 * screen that can't work for them.
 */
function RequireCrmAccess({ children }: { children: ReactNode }) {
  if (!isLoggedIn()) return <Navigate to="/login" replace />;
  const user = currentUser();
  if (!user || (user.role !== "ADMIN" && user.role !== "VIEWER")) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export default function App() {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    checkSession().then(() => { if (alive) setStatus("ready"); }).catch(() => { if (alive) setStatus("error"); });
    return () => { alive = false; };
  }, [attempt]);
  if (status === "loading") return <Loading />;
  if (status === "error") return <main className="gate-page"><div className="gate-card" role="alert"><p>לא הצלחנו לבדוק את החיבור לחשבון.</p><button className="btn btn-primary" onClick={() => { setStatus("loading"); setAttempt((n) => n + 1); }}>ניסיון נוסף</button></div></main>;
  return (
    <ThemeProvider>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          {/* Old entry point — kept so existing bookmarks and links still land. */}
          <Route path="/gate" element={<Navigate to="/login" replace />} />
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
            <Route path="/onboarding" element={<OnboardingPage />} />
            <Route path="/imports" element={<ImportJourneyPage />} />
            <Route path="/data" element={<FinancialDataPage />} />
            <Route path="/review" element={<ReviewPage />} />
            <Route path="/check-in" element={<CheckInPage />} />
            <Route path="/commitments" element={<CommitmentsPage />} />
            <Route path="/settings" element={<SettingsHubPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>

          {/* CRM — internal tool, own layout (no Sidebar/BottomNav from the
              customer-facing app), same gate login. See CrmLayout.tsx. */}
          <Route
            path="/crm"
            element={
              <RequireCrmAccess>
                <CrmLayout />
              </RequireCrmAccess>
            }
          >
            <Route index element={<Navigate to="customers" replace />} />
            <Route path="customers" element={<CrmCustomersPage />} />
            <Route path="customers/:id" element={<CrmCustomerDetailPage />} />
          </Route>
        </Routes>
      </Suspense>
    </ThemeProvider>
  );
}
