import { TabbedHub } from "../components/common/TabbedHub";
import { UNKNOWN_PLACEHOLDER, UncertaintyBadge } from "../components/common/UncertaintyBadge";
import { useAsync } from "../hooks/useAsync";
import { listLoans } from "../services/finance.service";
import { listBankAccounts, listSavingsGoals } from "../services/planning.service";
import { formatCurrency } from "../utils/format";
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
 * טאב "חשבונות וחובות" (IA §6): "how much do I have, how much do I owe, and
 * what does it cost me?".
 *
 * The three-chip strip is the only figure that crosses the sub-tabs — it is what
 * justifies the hub existing at all. It is deliberately lighter than a
 * `SummaryCard` so it does not compete with each sub-tab's own KPI row (§6.1).
 *
 * NOTE for `architect` (§9.4): assets/debts are composed here from three
 * existing endpoints. Every number used is one the backend already computed
 * (`LoanTotals.totalBalance`, `BankAccount.currentBalance`,
 * `SavingsGoal.currentAmount`) — no financial rule is re-implemented. Once
 * `GET /accounts/overview` exists this component should consume it instead.
 * The loans sub-tab dashboard (§6.5) is blocked on the §9.1 data model and is
 * intentionally untouched here.
 */
export default function AccountsPage() {
  const banksRes = useAsync(() => listBankAccounts(), [], "לא הצלחנו לטעון את חשבונות הבנק");
  const savingsRes = useAsync(() => listSavingsGoals(), [], "לא הצלחנו לטעון את יעדי החיסכון");
  const loansRes = useAsync(() => listLoans(), [], "לא הצלחנו לטעון את ההלוואות");

  const loading = banksRes.loading || savingsRes.loading || loansRes.loading;

  const bankTotal =
    banksRes.data === null ? null : banksRes.data.reduce((sum, a) => sum + Number(a.currentBalance), 0);
  const savingsTotal =
    savingsRes.data === null ? null : savingsRes.data.reduce((sum, g) => sum + Number(g.currentAmount), 0);
  const debts = loansRes.data === null ? null : loansRes.data.totals.totalBalance;

  const assets = bankTotal === null || savingsTotal === null ? null : bankTotal + savingsTotal;
  const netWorth = assets === null || debts === null ? null : assets - debts;

  return (
    <>
      <div className="overview-strip" aria-label="סיכום נכסים וחובות">
        <OverviewChip label="נכסים" amount={assets} tone="success" loading={loading} />
        <OverviewChip label="חובות" amount={debts} tone="danger" loading={loading} />
        <OverviewChip
          label="שווי נקי"
          amount={netWorth}
          tone={netWorth !== null && netWorth < 0 ? "danger" : "success"}
          loading={loading}
        />
      </div>

      <TabbedHub
        tabs={[
          { key: "credit", label: "אשראי", icon: "💳", element: <CreditPage /> },
          { key: "bank", label: "בנק", icon: "🏦", element: <BankPage /> },
          { key: "reconcile", label: "התאמת בנק", icon: "🔗", element: <BankReconcilePage /> },
          { key: "loans", label: "הלוואות וחובות", icon: "📉", element: <LoansPage /> },
          { key: "savings", label: "חיסכון ויעדים", icon: "🐷", element: <SavingsPage /> },
        ]}
      />
    </>
  );
}
