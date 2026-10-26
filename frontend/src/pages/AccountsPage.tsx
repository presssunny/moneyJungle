import { MetricExplanation } from "../components/common/MetricExplanation";
import { TabbedHub } from "../components/common/TabbedHub";
import { MissingValue } from "../components/common/MissingValue";
import { UncertaintyBadge } from "../components/common/UncertaintyBadge";
import { UNKNOWN_PLACEHOLDER } from "../utils/certainty";
import { useAsync } from "../hooks/useAsync";
import { listLoans } from "../services/finance.service";
import { listBankAccountsWithTotals, listSavingsGoals } from "../services/planning.service";
import { formatCurrency } from "../utils/format";
import AssetsPage from "./AssetsPage";
import BankPage from "./BankPage";
import BankReconcilePage from "./BankReconcilePage";
import ConnectionsPage from "./ConnectionsPage";
import CreditPage from "./CreditPage";
import LoansPage from "./LoansPage";
import SavingsPage from "./SavingsPage";

interface ChipProps {
  label: string;
  amount: number | null;
  tone?: "success" | "danger" | "default";
  loading: boolean;
  /** Set when the server could not value some items: `amount` then covers the rest only, a floor. */
  missingNote?: string;
}

/**
 * One hub-level figure. `amount === null` means a source did not load, and then
 * we say "לא ידוע" instead of quietly summing the rest into a confident-looking
 * number (IA §1.2 — a partial sum is never presented as a total).
 */
function OverviewChip({ label, amount, tone = "default", loading, missingNote }: ChipProps) {
  if (loading) return <span className="overview-chip overview-chip-loading" aria-hidden />;
  if (missingNote && amount === null) {
    return (
      <span className="overview-chip state-unknown">
        <span className="overview-chip-label">{label}</span>
        <span className="overview-chip-value">לא זמין</span>
        <span className="text-muted">{missingNote}</span>
      </span>
    );
  }
  if (missingNote && amount !== null) {
    return (
      <span className="overview-chip state-unknown">
        <span className="overview-chip-label">{label}</span>
        {amount === 0 ? (
          <MissingValue />
        ) : (
          <span className="overview-chip-value mono">לפחות {formatCurrency(amount)}</span>
        )}
        <span className="text-muted">{amount === 0 ? missingNote : `עוד ${missingNote}`}</span>
      </span>
    );
  }
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
  const banksRes = useAsync(() => listBankAccountsWithTotals(), [], "לא הצלחנו לטעון את חשבונות הבנק", ["bank","imports","documents"]);
  const savingsRes = useAsync(() => listSavingsGoals(), [], "לא הצלחנו לטעון את יעדי החיסכון", ["savings"]);
  const loansRes = useAsync(() => listLoans(), [], "לא הצלחנו לטעון את ההלוואות", ["loans","bank","imports","documents"]);

  const loading = banksRes.loading || savingsRes.loading || loansRes.loading;

  const bankTotal = banksRes.data?.totals.totalBalance ?? null;
  const unknownBanks = banksRes.data?.totals.unknownBalanceCount ?? 0;
  const banksNote =
    unknownBanks === 0 ? undefined : `${unknownBanks === 1 ? "חשבון אחד" : `${unknownBanks} חשבונות`} בלי יתרה ידועה`;
  const savingsTotal = savingsRes.data?.summary.savedTotal ?? null;
  const debts = loansRes.data === null ? null : loansRes.data.totals.totalBalance;
  const unknownDebts = loansRes.data?.totals.unknownBalanceCount ?? 0;
  const debtsNote =
    unknownDebts === 0 ? undefined : `${unknownDebts === 1 ? "הלוואה אחת" : `${unknownDebts} הלוואות`} ללא יתרה ידועה`;

  const assets = bankTotal; // Goal progress may already be included in bank cash.
  

  return (
    <>
      <TabbedHub
        overview={<div className="hub-overview">
      <div className="overview-strip" aria-label="סיכום נכסים וחובות">
        <OverviewChip label="יתרות בנק רשומות" amount={assets} tone="success" loading={loading} missingNote={banksNote} />
        <OverviewChip label="חובות" amount={debts} tone="danger" loading={loading} missingNote={debtsNote} />
        <OverviewChip
          label="התקדמות ביעדי חיסכון (עשויה לחפוף לבנק)"
          amount={savingsTotal}
          tone="default"
          loading={loading}
        />
      </div>

      <MetricExplanation title="מאיפה מגיעות יתרות הבנק" metric="cash"/>
      <MetricExplanation title="חובות וחיסכון רשום"><p>החובות הם יתרת הקרן לפי לוחות ההלוואות, ולא סכום ההחזרים הכולל ריבית. בכל הלוואה אפשר לפתוח את לוח הסילוקין ואת מסמך המקור.</p><p>התקדמות ביעדי חיסכון היא סכום הסכומים שנרשמו ביעדים. היא אינה נכס נוסף: אותו כסף עשוי כבר להיכלל בחשבון הבנק.</p></MetricExplanation>
        </div>}
        tabs={[
          { key: "credit", label: "כרטיסי אשראי", icon: "💳", element: <CreditPage /> },
          { key: "bank", label: "בנק", icon: "🏦", element: <BankPage /> },
          { key: "reconcile", label: "התאמת בנק", icon: "🔗", element: <BankReconcilePage /> },
          { key: "connections", label: "חשבונות מחוברים", icon: "🔌", element: <ConnectionsPage /> },
          { key: "loans", label: "הלוואות וחובות", icon: "📉", element: <LoansPage /> },
          { key: "savings", label: "חיסכון ויעדים", icon: "🐷", element: <SavingsPage /> },
          { key: "assets", label: "נכסים ושווי נטו", icon: "💎", element: <AssetsPage /> },
        ]}
      />
    </>
  );
}
