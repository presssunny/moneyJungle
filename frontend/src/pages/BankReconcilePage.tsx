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
  type ReconcileLoanGroup,
  type ReconcileRow,
  type ReconciliationView,
  type ResolveBucket,
  type ResolveResult,
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
 * דוח בנק מיובא נשמר כתנועות גולמיות, וכל שורה מקבלת **סיווג** אחד שקובע מה הכסף
 * הזה: הכנסה, הוצאה שוטפת, ריבית (הוצאה מימונית), קרן הלוואה (הקטנת חוב — לא
 * הוצאה), קבלת הלוואה (התחייבות — לא הכנסה), חיוב אשראי שכבר מפורט בטאב אשראי
 * (מוחרג כדי למנוע כפל ספירה) או העברה פנימית.
 *
 * המסך הזה הוא מסלול הביקורת של המספרים: הוא מציג לאן הלכה כל שורה ולמה, כולל
 * הסכומים שבכוונה אינם חלק מההוצאות. שורה בלי סיווג היא באג — היא לא נספרת באף
 * מספר במערכת — ולכן היא מוצגת באדום.
 */
export default function BankReconcilePage() {
  const res = useAsync<ReconciliationView>(
    () => getReconciliation(),
    [],
    "לא הצלחנו לטעון את נתוני ההתאמה"
  );
  const { expenseCategories } = useLookups();
  const [busy, setBusy] = useState(false);
  const [autoResult, setAutoResult] = useState<ResolveResult | null>(null);

  async function runAuto() {
    setBusy(true);
    try {
      const result = await reconcileAuto();
      setAutoResult(result);
      toast.success(
        result.changed > 0 ? `${result.changed} שורות סווגו מחדש` : "הסיווג היה מעודכן — אין שינוי"
      );
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
              <SummaryChip label="שורות בדוח" value={data.summary.total} tone="default" />
              <SummaryChip label="דורש תשומת לב" value={data.summary.needsReview} tone="danger" />
              <SummaryChip
                label="ללא סיווג"
                value={data.summary.unresolved}
                tone={data.summary.unresolved > 0 ? "danger" : "success"}
              />
              <SummaryChip label="מוחרגים (כפל ספירה)" value={data.summary.excluded} tone="default" />
            </div>

            {/* The whole point of the screen: every shekel in the statement, and
                which figure in the app it ended up in. A row that is absent from
                the expense total is listed here saying where it went instead. */}
            <Card title="לאן הלך כל שקל בדוח">
              <p className="muted">
                כל שורה בדוח מקבלת סיווג. סכומים שאינם הוצאה שוטפת — קרן הלוואה, חיוב אשראי שכבר
                מפורט בטאב אשראי, העברה פנימית — מופיעים כאן בשם שלהם, כדי שהסכומים בדשבורד לא
                ייראו חסרים.
              </p>
              {data.summary.unresolved > 0 && (
                <p className="tone-danger">
                  ⚠ {data.summary.unresolved} שורות ללא סיווג — הן אינן נספרות באף מספר במערכת.
                </p>
              )}
              <ResolutionBreakdown data={data} />
              <div className="row-actions">
                <Button onClick={runAuto} disabled={busy}>
                  סווגי מחדש את כל הדוח 🪄
                </Button>
              </div>
              {autoResult && <ResolveReport result={autoResult} />}
            </Card>

            {/* ----- דורש תשומת לב ----- */}
            {data.needsReview.length > 0 && (
              <Card title={`דורש תשומת לב (${data.needsReview.length})`}>
                <p className="muted">
                  השורות האלו סווגו — הכסף נספר או הוחרג במפורש — אבל הסיווג מבוסס על מה שהדוח לא
                  אומר במלואו. הסיבה רשומה ליד כל שורה, ואפשר לשנות ידנית.
                </p>
                <div className="reconcile-list">
                  {data.needsReview.map((row) => (
                    <ReviewRow key={row.id} row={row} busy={busy} run={run} />
                  ))}
                </div>
              </Card>
            )}

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

            {/* ----- חיובי אשראי ----- */}
            {data.creditCardPayments.length > 0 && (
              <Card title={`חיובי כרטיס אשראי (${data.creditCardPayments.length})`}>
                <p className="muted">
                  חיוב שהכרטיס שלו מיובא לטאב אשראי מוחרג מההוצאות — העסקאות עצמן כבר נספרות שם, וספירה
                  של שני הצדדים תכפיל את אותו כסף. חיוב של כרטיס שאין לו דוח מיובא כן נספר כהוצאה, אחרת
                  הכסף פשוט נעלם מהמערכת.
                </p>
                <div className="reconcile-list">
                  {data.creditCardPayments.map((row) => (
                    <ReadonlyRow key={row.id} row={row} />
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
                    <ReadonlyRow key={row.id} row={row} />
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
                      <span className="reconcile-note">{row.resolutionLabel ?? "ללא סיווג"}</span>
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
 * Where the statement's money ended up, by meaning. Split into "counted as
 * spending / income" and "real money, counted elsewhere" — the second list is the
 * important one: it is how a total that looks too small proves it is not missing
 * anything, because every excluded shekel names the figure that holds it.
 */
function ResolutionBreakdown({ data }: { data: ReconciliationView }) {
  const inFigures = new Set([
    "income",
    "expense",
    "financing_charge",
    "financing_credit",
    "credit_card_unitemized",
  ]);
  const counted = data.byResolution.filter((g) => inFigures.has(g.resolution));
  const elsewhere = data.byResolution.filter((g) => !inFigures.has(g.resolution));

  return (
    <div className="auto-result">
      <h4>נספר בהכנסות ובהוצאות</h4>
      <ul className="auto-result-list">
        {counted.map((group) => (
          <li key={group.resolution}>
            <span className="auto-result-label">{group.label}</span>
            <span className="muted">{group.count} תנועות</span>
            <span className="mono">{formatCurrency(group.total)}</span>
          </li>
        ))}
      </ul>

      {elsewhere.length > 0 && (
        <>
          <h4>כסף אמיתי שאינו הוצאה שוטפת</h4>
          <ul className="auto-result-list">
            {elsewhere.map((group) => (
              <li key={group.resolution}>
                <span className="auto-result-label">{group.label}</span>
                <span className="muted">{group.count} תנועות</span>
                <span className="mono">{formatCurrency(group.total)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/** What the last resolve pass decided. Only non-empty buckets are listed. */
function ResolveReport({ result }: { result: ResolveResult }) {
  const allBuckets: Array<[string, ResolveBucket]> = [
    ["הכנסות", result.income],
    ["הוצאות שוטפות", result.spend],
    ["ריבית — הוצאה מימונית", result.financingCharged],
    ["זיכויי ריבית — מימון שלילי", result.financingCredited],
    ["חיובי אשראי ללא פירוט — נספרו כהוצאה", result.cardUnitemized],
    ["קרן הלוואה — הקטנת חוב", result.debtReduction],
    ["תשלומי הלוואה ללא פירוט", result.loanUnsplit],
    ["קבלת הלוואה — התחייבות", result.loanDrawdown],
    ["חיובי אשראי מפורטים — מוחרגים", result.cardSettled],
    ["העברות פנימיות — מוחרגות", result.internalTransfer],
    ["הוחרג ידנית", result.manualExcluded],
  ];
  const buckets = allBuckets.filter(([, bucket]) => bucket.count > 0);

  return (
    <div className="auto-result">
      <h4>{result.changed === 0 ? "אין שינוי — הסיווג היה מעודכן" : `${result.changed} שורות עודכנו`}</h4>
      <ul className="auto-result-list">
        {buckets.map(([label, bucket]) => (
          <li key={label}>
            <span className="auto-result-label">{label}</span>
            <span className="muted">{bucket.count} תנועות</span>
            <span className="mono">{formatCurrency(bucket.total)}</span>
          </li>
        ))}
      </ul>
      <p className={result.unresolved.count > 0 ? "tone-danger" : "muted"}>
        {result.unresolved.count > 0
          ? `⚠ ${result.unresolved.count} שורות ללא סיווג (${formatCurrency(result.unresolved.total)}) — אינן נספרות באף מספר`
          : "כל שורה בדוח קיבלה סיווג — אין כסף שנופל בין הכיסאות"}
      </p>
    </div>
  );
}

/**
 * A resolved row that still deserves a second look, with the reason the resolver
 * wrote. The actions are the escape hatches: exclude it, or send it back to be
 * resolved again after the underlying data changed.
 */
function ReviewRow({ row, busy, run }: RowActionProps) {
  return (
    <div className="reconcile-row review-row">
      <span className="reconcile-date mono">{formatDate(row.date)}</span>
      <span className="reconcile-desc">
        {row.description}
        {row.reconcileNote && <small className="muted block">{row.reconcileNote}</small>}
      </span>
      <span className="reconcile-amount mono">{formatCurrency(row.amount)}</span>
      <span className="reconcile-note">{row.resolutionLabel}</span>
      <Button
        variant="ghost"
        size="sm"
        disabled={busy}
        onClick={() => run(() => reconcileExclude(row.id), "הוחרג — לא ייספר")}
      >
        הוצא מהסכומים
      </Button>
      <Button
        variant="ghost"
        size="sm"
        disabled={busy}
        onClick={() => run(() => reconcileReset(row.id), "סווג מחדש")}
      >
        סווג מחדש
      </Button>
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

/** A row the user does not have to act on: its resolution and reason say it all. */
function ReadonlyRow({ row }: { row: ReconcileRow }) {
  return (
    <div className="reconcile-row muted-row">
      <span className="reconcile-date mono">{formatDate(row.date)}</span>
      <span className="reconcile-desc">
        {row.description}
        {row.reconcileNote && <small className="muted block">{row.reconcileNote}</small>}
      </span>
      <span className="reconcile-amount mono">{formatCurrency(row.amount)}</span>
      <span className="reconcile-note">{row.resolutionLabel ?? "ללא סיווג"}</span>
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
