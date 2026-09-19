import { MetricExplanation } from "../components/common/MetricExplanation";
import { TabbedHub } from "../components/common/TabbedHub";
import { UNKNOWN_PLACEHOLDER, UncertaintyBadge } from "../components/common/UncertaintyBadge";
import { useAsync } from "../hooks/useAsync";
import { listLoans } from "../services/finance.service";
import { listBankAccounts, listSavingsGoals } from "../services/planning.service";
import { formatCurrency } from "../utils/format";
import AssetsPage from "./AssetsPage";
import BankPage from "./BankPage";
import BankReconcilePage from "./BankReconcilePage";
import CreditPage from "./CreditPage";
import LoansPage from "./LoansPage";
import SavingsPage from "./SavingsPage";

interface ChipProps {
  label: string;
  amount: number | null;
  tone?: "success" | "danger" | "default";
  loading: boolean;
}

/**
 * One hub-level figure. `amount === null` means a source did not load, and then
 * we say "לא ידוע" instead of quietly summing the rest into a confident-looking
 * number (IA §1.2 — a partial sum is never presented as a total).
 */
function OverviewChip({ label, amount, tone = "default", loading }: ChipProps) {
  if (loading) return <span className="overview-chip overview-chip-loading" aria-hidden />;
  return (
    <span className={`overview-chip ${amount === null ? "state-unknown" : ""}`}>
      <span className="overview-chip-label">{label}</span>
      {amount === null ? (
        <>
          <span className="overview-chip-value mono">{UNKNOWN_PLACEHOLDER}</span>
          <UncertaintyBadge level="unknown" />
        </>
      ) : (
        <span className={`overview-chip-value mono tone-${tone}`}>{formatCurrency(amount)}</span>
      )}
    </span>
  );
}

/**
 * Accounts and debts hub (IA §6). The three-chip strip is the only figure
 * crossing the sub-tabs, kept lighter than a `SummaryCard` so it does not compete
 * with their own KPI rows. Composed from existing endpoints — no financial rule
 * is re-implemented. Should consume `GET /accounts/overview` once it exists.
 */
export default function AccountsPage() {
  const banksRes = useAsync(() => listBankAccounts(), [], "לא הצלחנו לטעון את חשבונות הבנק", ["bank","imports","documents"]);
  const savingsRes = useAsync(() => listSavingsGoals(), [], "לא הצלחנו לטעון את יעדי החיסכון", ["savings"]);
  const loansRes = useAsync(() => listLoans(), [], "לא הצלחנו לטעון את ההלוואות", ["loans","bank","imports","documents"]);

  const loading = banksRes.loading || savingsRes.loading || loansRes.loading;

  const bankTotal =
    banksRes.data === null ? null : banksRes.data.reduce((sum, a) => sum + Number(a.currentBalance), 0);
  const savingsTotal =
    savingsRes.data === null ? null : savingsRes.data.reduce((sum, g) => sum + Number(g.currentAmount), 0);
  const debts = loansRes.data === null ? null : loansRes.data.totals.totalBalance;

  const assets = bankTotal; // Goal progress may already be included in bank cash.
  

  return (
    <>
      <div className="overview-strip" aria-label="סיכום נכסים וחובות">
        <OverviewChip label="יתרות בנק רשומות" amount={assets} tone="success" loading={loading} />
        <OverviewChip label="חובות" amount={debts} tone="danger" loading={loading} />
        <OverviewChip
          label="התקדמות ביעדי חיסכון (עשויה לחפוף לבנק)"
          amount={savingsTotal}
          tone="default"
          loading={loading}
        />
      </div>

      <MetricExplanation title="מקורות יתרות הבנק" metric="cash"/>
      <MetricExplanation title="חובות וחיסכון רשום"><p>החובות הם יתרת הקרן לפי לוחות ההלוואות, ולא סכום ההחזרים הכולל ריבית. בכל הלוואה אפשר לפתוח את לוח הסילוקין ואת מסמך המקור.</p><p>התקדמות ביעדי חיסכון היא סכום הסכומים שנרשמו ביעדים. היא אינה נכס נוסף: אותו כסף עשוי כבר להיכלל בחשבון הבנק.</p></MetricExplanation>
      <TabbedHub
        tabs={[
          { key: "credit", label: "אשראי", icon: "💳", element: <CreditPage /> },
          { key: "bank", label: "בנק", icon: "🏦", element: <BankPage /> },
          { key: "reconcile", label: "התאמת בנק", icon: "🔗", element: <BankReconcilePage /> },
          { key: "loans", label: "הלוואות וחובות", icon: "📉", element: <LoansPage /> },
          { key: "savings", label: "חיסכון ויעדים", icon: "🐷", element: <SavingsPage /> },
          { key: "assets", label: "נכסים ושווי נטו", icon: "💎", element: <AssetsPage /> },
        ]}
      />
    </>
  );
}
