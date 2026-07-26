import { useState } from "react";
import { AsyncSection } from "../components/common/AsyncSection";
import { Button } from "../components/common/Button";
import { Card } from "../components/common/Card";
import { EmptyState } from "../components/common/EmptyState";
import { Input } from "../components/common/Input";
import { Select } from "../components/common/Select";
import { SkeletonRows } from "../components/common/Skeleton";
import { useAsync } from "../hooks/useAsync";
import { useLookups } from "../hooks/useLookups";
import { apiErrorMessage } from "../services/api";
import {
  getReconciliation,
  reconcileAuto,
  reconcileExclude,
  reconcileExpense,
  reconcileIncome,
  reconcileLoan,
  reconcileReset,
  type AutoReconcileResult,
  type ReconcileLoanGroup,
  type ReconcileRow,
  type ReconciliationView,
} from "../services/planning.service";
import { toast } from "../services/toast";
import { formatCurrency, formatDate } from "../utils/format";

const INCOME_TYPE_OPTIONS = [
  { value: "salary", label: "משכורת" },
  { value: "allowance", label: "קצבה" },
  { value: "business", label: "עסק" },
  { value: "refund", label: "החזר/זיכוי" },
  { value: "extra", label: "הכנסה נוספת" },
  { value: "gift", label: "מתנה" },
  { value: "one_time", label: "חד־פעמי" },
];

const LOAN_TYPE_OPTIONS = [
  { value: "bank", label: "בנקאית" },
  { value: "car", label: "רכב" },
  { value: "mortgage", label: "משכנתא" },
  { value: "private", label: "פרטית" },
  { value: "credit", label: "אשראי" },
  { value: "other", label: "אחר" },
];

/**
 * מסך התאמת בנק (reconciliation).
 *
 * דוח בנק מיובא נשמר כתנועות גולמיות. כאן המשתמשת מאשרת לאן כל שורה שייכת — הפקדה
 * הופכת להכנסה, תשלומי קרן/ריבית הופכים/מקושרים להלוואה, משיכה רגילה יכולה להפוך
 * להוצאה. חיובי כרטיס אשראי מוחרגים אוטומטית (כבר מפורטים במודול האשראי) כדי למנוע
 * ספירה כפולה. אחרי אישור, הנתון מופיע בטאב ובדשבורד דרך אותן שאילתות קיימות.
 */
export default function BankReconcilePage() {
  const res = useAsync<ReconciliationView>(
    () => getReconciliation(),
    [],
    "לא הצלחנו לטעון את נתוני ההתאמה"
  );
  const { expenseCategories } = useLookups();
  const [busy, setBusy] = useState(false);
  const [autoResult, setAutoResult] = useState<AutoReconcileResult | null>(null);

  async function runAuto() {
    setBusy(true);
    try {
      const result = await reconcileAuto();
      setAutoResult(result);
      const promoted = result.incomeCount + result.spendCount + result.financingCount;
      toast.success(promoted > 0 ? `${promoted} תנועות נכנסו לסכומים` : "אין תנועות חדשות לשיוך");
      res.reload();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function run(action: () => Promise<void>, okMsg: string) {
    setBusy(true);
    try {
      await action();
      toast.success(okMsg);
      res.reload();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="reconcile-page">
      <AsyncSection
        resource={res}
        errorTitle="לא הצלחנו לטעון את נתוני ההתאמה"
        skeleton={<SkeletonRows rows={6} />}
        isEmpty={(d) => d.summary.total === 0}
        emptyState={
          <EmptyState
            icon="🏦"
            title="אין תנועות בנק לייבוא"
            hint="ייבאי דוח עו״ש בטאב הבנק, וכאן תוכלי לשייך כל שורה למקום הנכון."
          />
        }
      >
        {(data) => (
          <>
            <div className="reconcile-summary" aria-label="סיכום התאמה">
              <SummaryChip label="ממתין להכנסה" value={data.summary.pendingIncome} tone="success" />
              <SummaryChip label="ממתין להלוואה" value={data.summary.pendingLoan} tone="danger" />
              <SummaryChip label="ממתין להוצאה" value={data.summary.pendingSpend} tone="default" />
              <SummaryChip label="הושלמו" value={data.summary.done} tone="success" />
              <SummaryChip label="מוחרגים" value={data.summary.excluded} tone="default" />
            </div>

            {/* Bulk pass. The per-row controls below stay: this button only
                handles what the statement says unambiguously. */}
            <Card title="שיוך אוטומטי">
              <p className="muted">
                מכניס לסכומים כל שורה שהדוח קובע בבירור: הפקדה רגילה → הכנסה, משיכה רגילה → הוצאה,
                ריבית → הוצאת מימון. שורות שדורשות החלטה שלך נשארות למטה ואינן נספרות עד שתאשרי.
              </p>
              <div className="row-actions">
                <Button onClick={runAuto} disabled={busy}>
                  שייכי אוטומטית את מה שברור 🪄
                </Button>
              </div>
              {autoResult && <AutoResultReport result={autoResult} />}
            </Card>

            {/* ----- הכנסות שזוהו ----- */}
            <Card title={`הכנסות שזוהו (${data.incomeCandidates.length})`}>
              {data.incomeCandidates.length === 0 ? (
                <p className="muted">אין הפקדות שממתינות לשיוך.</p>
              ) : (
                <div className="reconcile-list">
                  {data.incomeCandidates.map((row) => (
                    <IncomeRow key={row.id} row={row} busy={busy} run={run} />
                  ))}
                </div>
              )}
            </Card>

            {/* ----- הלוואות שזוהו ----- */}
            <Card title={`הלוואות שזוהו (${data.loanGroups.length})`}>
              {data.loanGroups.length === 0 ? (
                <p className="muted">לא זוהו תשלומי הלוואה בדוח.</p>
              ) : (
                <div className="reconcile-list">
                  {data.loanGroups.map((group) => (
                    <LoanGroupCard key={group.loanRef ?? "none"} group={group} busy={busy} run={run} />
                  ))}
                </div>
              )}
            </Card>

            {/* ----- הוצאה שוטפת ----- */}
            <Card title={`משיכות רגילות → הוצאה שוטפת (${data.standardSpend.length})`}>
              {data.standardSpend.length === 0 ? (
                <p className="muted">אין משיכות רגילות שממתינות לשיוך.</p>
              ) : (
                <div className="reconcile-list">
                  {data.standardSpend.map((row) => (
                    <SpendRow
                      key={row.id}
                      row={row}
                      busy={busy}
                      run={run}
                      categories={expenseCategories.map((c) => ({ value: String(c.id), label: c.name }))}
                    />
                  ))}
                </div>
              )}
            </Card>

            {/* ----- חיובי אשראי מוחרגים ----- */}
            {data.creditCardPayments.length > 0 && (
              <Card title={`חיובי כרטיס אשראי — מוחרגים (${data.creditCardPayments.length})`}>
                <p className="muted">
                  שורות אלו כבר מפורטות במודול האשראי. הן מוחרגות מההוצאות כדי למנוע ספירה כפולה.
                </p>
                <div className="reconcile-list">
                  {data.creditCardPayments.map((row) => (
                    <ReadonlyRow key={row.id} row={row} note="בכרטיסי האשראי" />
                  ))}
                </div>
              </Card>
            )}

            {/* ----- מימון (ריבית) ----- */}
            {data.financingLines.length > 0 && (
              <Card title={`הוצאות מימון — ריבית (${data.financingLines.length})`}>
                <p className="muted">
                  ריבית הלוואות ומסגרת וזיכויי ריבית. הוצאה מימונית, לא הוצאה שוטפת — מוצגת לידיעה.
                </p>
                <div className="reconcile-list">
                  {data.financingLines.map((row) => (
                    <ReadonlyRow
                      key={row.id}
                      row={row}
                      note={row.lineKind === "interest_credit" ? "זיכוי ריבית" : "ריבית"}
                    />
                  ))}
                </div>
              </Card>
            )}

            {/* ----- הושלמו ----- */}
            {data.done.length > 0 && (
              <Card title={`הושלמו (${data.done.length})`}>
                <div className="reconcile-list">
                  {data.done.map((row) => (
                    <div key={row.id} className="reconcile-row done">
                      <span className="reconcile-date mono">{formatDate(row.date)}</span>
                      <span className="reconcile-desc">{row.description}</span>
                      <span className="reconcile-amount mono">{formatCurrency(row.amount)}</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={() => run(() => reconcileReset(row.id), "השיוך בוטל")}
                      >
                        בטל שיוך
                      </Button>
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </>
        )}
      </AsyncSection>
    </div>
  );
}

/**
 * What the last auto pass did. The held-back list is the important half: it is
 * the app stating, in money, what it refused to guess — so a total that looks
 * complete can be checked against what is knowingly missing from it.
 */
function AutoResultReport({ result }: { result: AutoReconcileResult }) {
  const counted: Array<[string, number, number]> = [
    ["הכנסות", result.incomeCount, result.incomeTotal],
    ["הוצאות שוטפות", result.spendCount, result.spendTotal],
    ["ריבית (הוצאת מימון)", result.financingCount, result.financingTotal],
  ];
  const held: Array<[string, number, number, string]> = [
    [
      "החזרי קרן הלוואה",
      result.heldPrincipalCount,
      result.heldPrincipalTotal,
      "הקטנת חוב, לא הוצאה — שייכי להלוואה למטה",
    ],
    [
      "תשלומי הלוואה ללא פירוט",
      result.heldMixedCount,
      result.heldMixedTotal,
      "הדוח לא מפצל בין קרן לריבית",
    ],
    [
      "הפקדות חריגות בגודלן",
      result.heldAtypicalCount,
      result.heldAtypicalTotal,
      "גדולות בהרבה משאר ההפקדות — ייתכן שזו הלוואה או העברה, לא הכנסה",
    ],
    [
      "כסף שיצא וחזר",
      result.heldRoundTripCount,
      result.heldRoundTripTotal,
      "נראה כמו העברה פנימית בין חשבונות",
    ],
    [
      "זיכויי ריבית",
      result.heldInterestCreditCount,
      result.heldInterestCreditTotal,
      "החזר ריבית מהבנק — לא הכנסה",
    ],
  ];
  const heldShown = held.filter(([, count]) => count > 0);

  return (
    <div className="auto-result">
      <h4>נכנס לסכומים</h4>
      <ul className="auto-result-list">
        {counted.map(([label, count, total]) => (
          <li key={label}>
            <span className="auto-result-label">{label}</span>
            <span className="muted">{count} תנועות</span>
            <span className="mono">{formatCurrency(total)}</span>
          </li>
        ))}
      </ul>

      {heldShown.length > 0 && (
        <>
          <h4>הושאר לך להחליט — לא נספר</h4>
          <ul className="auto-result-list">
            {heldShown.map(([label, count, total, why]) => (
              <li key={label}>
                <span className="auto-result-label">
                  {label}
                  <small className="muted"> — {why}</small>
                </span>
                <span className="muted">{count} תנועות</span>
                <span className="mono">{formatCurrency(total)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function SummaryChip({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <span className={`reconcile-chip tone-${tone}`}>
      <span className="reconcile-chip-value mono">{value}</span>
      <span className="reconcile-chip-label">{label}</span>
    </span>
  );
}

interface RowActionProps {
  row: ReconcileRow;
  busy: boolean;
  run: (action: () => Promise<void>, okMsg: string) => Promise<void>;
}

function IncomeRow({ row, busy, run }: RowActionProps) {
  const [type, setType] = useState(row.suggestedIncomeType ?? "extra");
  return (
    <div className="reconcile-row">
      <span className="reconcile-date mono">{formatDate(row.date)}</span>
      <span className="reconcile-desc">{row.description}</span>
      <span className="reconcile-amount mono tone-success">{formatCurrency(row.amount)}</span>
      <Select
        aria-label="סוג הכנסה"
        value={type}
        options={INCOME_TYPE_OPTIONS}
        onChange={(e) => setType(e.target.value)}
      />
      <Button
        variant="primary"
        size="sm"
        disabled={busy}
        onClick={() => run(() => reconcileIncome(row.id, { type }), "נוספה הכנסה")}
      >
        הפוך להכנסה
      </Button>
      <Button
        variant="ghost"
        size="sm"
        disabled={busy}
        onClick={() => run(() => reconcileExclude(row.id), "הוחרג")}
      >
        התעלם
      </Button>
    </div>
  );
}

function SpendRow({
  row,
  busy,
  run,
  categories,
}: RowActionProps & { categories: { value: string; label: string }[] }) {
  const [categoryId, setCategoryId] = useState("");
  return (
    <div className="reconcile-row">
      <span className="reconcile-date mono">{formatDate(row.date)}</span>
      <span className="reconcile-desc">{row.description}</span>
      <span className="reconcile-amount mono tone-danger">{formatCurrency(row.amount)}</span>
      <Select
        aria-label="קטגוריה"
        value={categoryId}
        placeholder="קטגוריה (אופ׳)"
        options={categories}
        onChange={(e) => setCategoryId(e.target.value)}
      />
      <Button
        variant="primary"
        size="sm"
        disabled={busy}
        onClick={() =>
          run(
            () => reconcileExpense(row.id, { categoryId: categoryId ? Number(categoryId) : null }),
            "נוספה הוצאה"
          )
        }
      >
        הפוך להוצאה
      </Button>
      <Button
        variant="ghost"
        size="sm"
        disabled={busy}
        onClick={() => run(() => reconcileExclude(row.id), "הוחרג")}
      >
        התעלם
      </Button>
    </div>
  );
}

function ReadonlyRow({ row, note }: { row: ReconcileRow; note: string }) {
  return (
    <div className="reconcile-row muted-row">
      <span className="reconcile-date mono">{formatDate(row.date)}</span>
      <span className="reconcile-desc">{row.description}</span>
      <span className="reconcile-amount mono">{formatCurrency(row.amount)}</span>
      <span className="reconcile-note">{note}</span>
    </div>
  );
}

function LoanGroupCard({
  group,
  busy,
  run,
}: {
  group: ReconcileLoanGroup;
  busy: boolean;
  run: (action: () => Promise<void>, okMsg: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const monthlyGuess = group.principalTotal + group.interestTotal + group.mixedTotal;
  const [form, setForm] = useState({
    loanName: group.loanRef ? `הלוואה ${group.loanRef}` : "הלוואה מיובאת",
    loanType: "bank",
    originalAmount: "",
    annualInterestRate: "",
    monthlyPayment: monthlyGuess ? monthlyGuess.toFixed(2) : "",
  });

  return (
    <div className="reconcile-loan-group">
      <div className="reconcile-loan-head">
        <strong>{group.label}</strong>
        <span className="reconcile-loan-totals mono">
          קרן {formatCurrency(group.principalTotal)} · ריבית {formatCurrency(group.interestTotal)}
          {group.mixedTotal > 0 && <> · תשלום {formatCurrency(group.mixedTotal)}</>} · {group.count} שורות
        </span>
        <Button variant="outline" size="sm" onClick={() => setOpen((o) => !o)}>
          {open ? "סגור" : "צור הלוואה"}
        </Button>
      </div>
      {open && (
        <div className="reconcile-loan-form">
          <Input
            label="שם ההלוואה"
            value={form.loanName}
            onChange={(e) => setForm({ ...form, loanName: e.target.value })}
          />
          <Select
            label="סוג"
            value={form.loanType}
            options={LOAN_TYPE_OPTIONS}
            onChange={(e) => setForm({ ...form, loanType: e.target.value })}
          />
          <Input
            label="סכום מקורי"
            type="number"
            value={form.originalAmount}
            onChange={(e) => setForm({ ...form, originalAmount: e.target.value })}
          />
          <Input
            label="ריבית שנתית %"
            type="number"
            value={form.annualInterestRate}
            onChange={(e) => setForm({ ...form, annualInterestRate: e.target.value })}
          />
          <Input
            label="תשלום חודשי"
            type="number"
            value={form.monthlyPayment}
            onChange={(e) => setForm({ ...form, monthlyPayment: e.target.value })}
          />
          <Button
            variant="primary"
            size="sm"
            disabled={busy || !form.loanName}
            onClick={() =>
              run(
                () =>
                  reconcileLoan({
                    transactionIds: group.rows.map((r) => r.id),
                    loanName: form.loanName,
                    loanType: form.loanType,
                    originalAmount: form.originalAmount ? Number(form.originalAmount) : 0,
                    annualInterestRate: form.annualInterestRate ? Number(form.annualInterestRate) : 0,
                    monthlyPayment: form.monthlyPayment ? Number(form.monthlyPayment) : 0,
                  }),
                "נוצרה הלוואה"
              )
            }
          >
            צור וקשר {group.count} שורות
          </Button>
        </div>
      )}
    </div>
  );
}
