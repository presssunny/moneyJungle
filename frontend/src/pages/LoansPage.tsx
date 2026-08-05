import { useState, type FormEvent } from "react";
import { AsyncSection } from "../components/common/AsyncSection";
import { Button } from "../components/common/Button";
import { Card } from "../components/common/Card";
import { useConfirm } from "../components/common/ConfirmDialog";
import { DropZone } from "../components/common/DropZone";
import { EmptyState } from "../components/common/EmptyState";
import { ErrorMessage } from "../components/common/ErrorMessage";
import { Input } from "../components/common/Input";
import { Modal } from "../components/common/Modal";
import { PageShell } from "../components/common/PageShell";
import { Select } from "../components/common/Select";
import { SkeletonKpiRow, SkeletonRows } from "../components/common/Skeleton";
import { Table, type Column } from "../components/common/Table";
import { UncertaintyBadge } from "../components/common/UncertaintyBadge";
import { SummaryCard } from "../components/dashboard/SummaryCard";
import { CloseLoanDialog } from "../components/loans/CloseLoanDialog";
import { EarlyRepaymentDialog } from "../components/loans/EarlyRepaymentDialog";
import { LoanCard, type LoanActions } from "../components/loans/LoanCard";
import { LoanCelebration } from "../components/loans/LoanCelebration";
import { LoanScheduleDrawer } from "../components/loans/LoanScheduleDrawer";
import { useAsync } from "../hooks/useAsync";
import { apiErrorMessage, toastApiError } from "../services/api";
import {
  createLoan,
  deleteLoan,
  importLoanSchedule,
  listLoans,
  updateLoan,
  type LoanInput,
  type ScheduleImportResult,
} from "../services/finance.service";
import type { StatementLoanGroup } from "../services/planning.service";
import type { Loan, LoanEvent } from "../types/models";
import { formatCurrency } from "../utils/format";

const LOAN_TYPES = [
  { value: "bank", label: "בנק" },
  { value: "credit", label: "אשראי" },
  { value: "car", label: "רכב" },
  { value: "mortgage", label: "משכנתא" },
  { value: "private", label: "פרטית" },
  { value: "other", label: "אחר" },
];

const STATUS_LABELS: Record<string, string> = {
  active: "פעילה",
  finished: "נסגרה",
  overdue: "בפיגור",
};

const emptyForm: LoanInput = {
  loanName: "",
  loanType: "bank",
  lenderName: "",
  originalAmount: 0,
  currentBalance: 0,
  annualInterestRate: 0,
  monthlyPayment: 0,
  startDate: new Date().toISOString().slice(0, 10),
};

/**
 * Loan management, not a list: summary → upload → active → closed → what the
 * statement reports. The amortisation table lives in a drawer so the screen reads
 * the same with two loans or twenty. Every number comes from `loans.service`
 * and is only rendered here (CLAUDE.md §4).
 */
export default function LoansPage() {
  const loansRes = useAsync(() => listLoans(), [], "לא הצלחנו לטעון את ההלוואות");
  const confirm = useConfirm();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Loan | null>(null);
  const [form, setForm] = useState<LoanInput>(emptyForm);
  const [error, setError] = useState("");

  const [scheduleFor, setScheduleFor] = useState<Loan | null>(null);
  const [quoteFor, setQuoteFor] = useState<Loan | null>(null);
  const [closingLoan, setClosingLoan] = useState<Loan | null>(null);
  const [celebrating, setCelebrating] = useState<LoanEvent | null>(null);

  const [showClosed, setShowClosed] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadResult, setUploadResult] = useState<ScheduleImportResult | null>(null);
  const [uploadTarget, setUploadTarget] = useState<Loan | null>(null);

  const data = loansRes.data;
  const active = data?.loans.filter((l) => l.status !== "finished") ?? [];
  const closed = data?.loans.filter((l) => l.status === "finished") ?? [];

  // A closure the server detected while loading. Celebrated once, then cleared
  // from the loaded data so a re-render does not throw the confetti again.
  const shownEvent = celebrating ?? data?.events?.[0] ?? null;

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setError("");
    setFormOpen(true);
  }

  function openEdit(loan: Loan) {
    setEditing(loan);
    setForm({
      loanName: loan.loanName,
      loanType: loan.loanType,
      lenderName: loan.lenderName ?? "",
      originalAmount: loan.originalAmount,
      currentBalance: loan.currentBalance,
      annualInterestRate: loan.annualInterestRate,
      monthlyPayment: loan.monthlyPayment,
      startDate: loan.startDate.slice(0, 10),
      endDate: loan.endDate?.slice(0, 10) ?? null,
      status: loan.status,
    });
    setError("");
    setFormOpen(true);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      const payload = { ...form, lenderName: form.lenderName || null, endDate: form.endDate || null };
      if (editing) await updateLoan(editing.id, payload);
      else await createLoan(payload);
      setFormOpen(false);
      loansRes.reload();
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  }

  async function onScheduleFile(file: File) {
    setUploadBusy(true);
    setUploadResult(null);
    try {
      const result = await importLoanSchedule(file, uploadTarget?.id);
      setUploadResult(result);
      setUploadTarget(null);
      loansRes.reload();
    } catch (err) {
      toastApiError(err);
    } finally {
      setUploadBusy(false);
    }
  }

  const actions: LoanActions = {
    onSchedule: setScheduleFor,
    onEdit: openEdit,
    onClose: setClosingLoan,
    onEarlyRepayment: setQuoteFor,
    onUploadSchedule: (loan) => {
      setUploadTarget(loan);
      setUploadResult(null);
      document.getElementById("loan-schedule-upload")?.scrollIntoView({ behavior: "smooth" });
    },
    onDelete: (loan) =>
      confirm.ask(
        {
          title: "מחיקת הלוואה",
          message: (
            <>
              ההלוואה <strong>{loan.loanName}</strong> תימחק.
              <span className="confirm-consequence">
                היתרה, ההחזר החודשי והריבית שלה ייעלמו מהדשבורד, מהתובנות ומתחזית התזרים. אם
                ההלוואה נפרעה — עדיף לסגור אותה, כדי לשמור את ההישג ואת החיסכון בהחזר.
              </span>
            </>
          ),
          confirmLabel: "מחיקה",
          tone: "danger",
        },
        async () => {
          await deleteLoan(loan.id);
          loansRes.reload();
        }
      ),
  };

  // Loan activity straight from the statement. Deliberately no "balance" column:
  // the statement says what was paid, never how much is left, and printing a
  // remaining balance we cannot know would be an invented number.
  const statementColumns: Column<StatementLoanGroup>[] = [
    {
      key: "label",
      header: "הלוואה",
      render: (row) => (
        <span>
          <strong>{row.label}</strong>
          <small className="text-muted block">
            {row.months.join(", ")} · {row.rows.length} שורות בדוח
          </small>
        </span>
      ),
    },
    {
      key: "principal",
      header: "קרן ששולמה",
      align: "left",
      render: (row) => <span className="mono">{formatCurrency(row.principalPaid)}</span>,
    },
    {
      key: "interest",
      header: "ריבית ששולמה",
      align: "left",
      render: (row) => <span className="mono text-warning">{formatCurrency(row.interestPaid)}</span>,
    },
    {
      key: "unsplit",
      header: "ללא פירוט",
      align: "left",
      render: (row) =>
        row.unsplitPaid > 0 ? (
          <span className="mono" title="הדוח לא מפצל בין קרן לריבית">
            {formatCurrency(row.unsplitPaid)}
          </span>
        ) : (
          <span className="text-muted">—</span>
        ),
    },
    {
      key: "drawdown",
      header: "התקבל",
      align: "left",
      render: (row) =>
        row.drawdown > 0 ? (
          <span className="mono text-success">{formatCurrency(row.drawdown)}</span>
        ) : (
          <span className="text-muted">—</span>
        ),
    },
  ];

  return (
    <PageShell
      toolbar={
        <>
          <Button onClick={openCreate}>+ הוספת הלוואה</Button>
          {closed.length > 0 && (
            <Button variant="ghost" onClick={() => setShowClosed((v) => !v)}>
              {showClosed ? "הסתרת" : "הצגת"} הלוואות שנסגרו ({closed.length})
            </Button>
          )}
        </>
      }
    >
      {/* ---------- Summary ---------- */}
      <AsyncSection
        resource={loansRes}
        errorTitle="לא הצלחנו לטעון את סיכום ההלוואות"
        skeleton={<SkeletonKpiRow count={6} label="טוען סיכום הלוואות" />}
      >
        {({ summary }) => (
          <div className="kpi-row loans-kpi-row">
            <SummaryCard label="הלוואות פעילות" value={String(summary.activeCount)} icon="🟢" />
            <SummaryCard label="נסגרו" value={String(summary.closedCount)} icon="⚫" />
            <SummaryCard
              label="יתרת הקרן"
              value={formatCurrency(summary.totalBalance)}
              icon="📉"
              tone={summary.totalBalance > 0 ? "danger" : "success"}
            />
            <SummaryCard label="החזר חודשי" value={formatCurrency(summary.monthlyPayment)} icon="📅" />
            <SummaryCard
              label="ריבית חודשית"
              value={formatCurrency(summary.monthlyInterest)}
              icon="💸"
              tone="warning"
              sub={`${formatCurrency(summary.annualInterest)} בשנה`}
            />
            <SummaryCard
              label="נחסך בהחזרים"
              value={formatCurrency(summary.freedMonthlyPayment)}
              icon="💚"
              tone="success"
              accent={summary.freedMonthlyPayment > 0}
              sub={
                summary.freedMonthlyPayment > 0
                  ? summary.closureCosts > 0
                    ? `לחודש · עלות סגירה ${formatCurrency(summary.closureCosts)}`
                    : "לחודש, אחרי סגירת הלוואות"
                  : "עוד לא נסגרו הלוואות"
              }
            />
          </div>
        )}
      </AsyncSection>

      {/* ---------- Schedule upload ---------- */}
      <Card title={uploadTarget ? `העלאת לוח סילוקין — ${uploadTarget.loanName}` : "העלאת לוח סילוקין מהבנק"}>
        <div id="loan-schedule-upload">
          <p className="settings-hint">
            הלוח של הבנק הוא מקור האמת של ההלוואה: היתרה, הריבית, ההחזר, מספר התשלומים ותאריך
            הסיום נקראים ממנו — בלי להזין כלום ידנית. העלאה חוזרת של אותה הלוואה{" "}
            <strong>מעדכנת</strong> אותה ולא יוצרת כפילות.
            {uploadTarget && (
              <>
                {" "}
                <Button size="sm" variant="ghost" onClick={() => setUploadTarget(null)}>
                  ביטול השיוך להלוואה זו
                </Button>
              </>
            )}
          </p>
          <DropZone
            onFile={onScheduleFile}
            busy={uploadBusy}
            accept=".xlsx,.xls"
            icon="🏦"
            title={uploadBusy ? "קורא את הלוח..." : "גררי לכאן את קובץ לוח הסילוקין, או לחצי לבחירה"}
            hint="הקובץ שהבנק מייצא, עם עמודות מספר תשלום קרן · תאריך · קרן · ריבית · יתרה"
          />

          {uploadResult && (
            <div className="info-banner">
              <div>
                <span aria-hidden>✅</span> {uploadResult.message}
              </div>
              <div className="text-muted">נשמרו {uploadResult.rowsStored} שורות תשלום.</div>
              {/* Where the file could not answer, the app asks instead of guessing. */}
              {uploadResult.questions.map((question) => (
                <div key={question.code} className="loan-question">
                  <span aria-hidden>❓</span> {question.text}
                  {question.code === "original_amount" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        const loan = data?.loans.find((l) => l.id === uploadResult.loanId);
                        if (loan) openEdit(loan);
                      }}
                    >
                      הזנת הסכום המקורי
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>

      {/* ---------- Active loans ---------- */}
      <AsyncSection
        resource={loansRes}
        errorTitle="לא הצלחנו לטעון את ההלוואות"
        skeleton={<SkeletonRows rows={2} label="טוען הלוואות" />}
        isEmpty={() => active.length === 0}
        emptyState={
          <Card>
            <EmptyState
              icon={closed.length > 0 ? "🎉" : "📉"}
              title={closed.length > 0 ? "אין הלוואות פעילות" : "אין הלוואות"}
              hint={
                closed.length > 0
                  ? "כל ההלוואות שלך נסגרו. אפשר לראות אותן בכפתור שלמעלה."
                  : "העלי לוח סילוקין מהבנק, או הוסיפי הלוואה ידנית"
              }
            />
          </Card>
        }
      >
        {({ summary }) => (
          <section aria-label="הלוואות פעילות">
            {summary.endingSoonCount > 0 && (
              <div className="info-banner">
                <span aria-hidden>🟠</span> {summary.endingSoonCount} הלוואות לקראת סיום — בקרוב
                יתפנה לך ההחזר החודשי שלהן.
              </div>
            )}
            {summary.hasScenarioProgress && (
              <div className="info-banner state-scenario">
                <span aria-hidden>≈</span> אחוזי הפירעון מסומנים כ־<UncertaintyBadge level="scenario" />{" "}
                כי לוח הסילוקין מתחיל באמצע, והסכום המקורי חושב לאחור. הזנת הסכום מהחוזה תהפוך
                אותם למדויקים.
              </div>
            )}
            <div className="loan-list">
              {active.map((loan) => (
                <LoanCard key={loan.id} loan={loan} actions={actions} />
              ))}
            </div>
          </section>
        )}
      </AsyncSection>

      {/* ---------- Closed loans ---------- */}
      {closed.length > 0 && showClosed && (
        <section aria-label="הלוואות שנסגרו">
          <Card title={`🔒 הלוואות שנסגרו (${closed.length})`}>
            <p className="settings-hint">
              הלוואה שנסגרה לא נמחקת — היא מראה מה כבר נפרע וכמה כסף התפנה בכל חודש.
            </p>
            <div className="loan-list">
              {closed.map((loan) => (
                <LoanCard key={loan.id} loan={loan} actions={actions} />
              ))}
            </div>
          </Card>
        </section>
      )}

      {/* ---------- What the statement itself says ---------- */}
      {data?.fromStatement && data.fromStatement.groups.length > 0 && (
        <Card title="תשלומי הלוואות לפי הדוח הבנקאי">
          <p className="text-muted">
            הסכומים כאן הם השורות של הבנק עצמו, לא תחזית: קרן שכבר שולמה (הקטנת חוב — לא הוצאה),
            ריבית שנגבתה (הוצאה מימונית) ותשלומים שהדוח לא פיצל בין קרן לריבית. הלוואה שלא הוגדרה
            למעלה עדיין מופיעה כאן, כדי שהתשלומים שלה לא ייעלמו.
          </p>
          <div className="toolbar-total">
            קרן ששולמה{" "}
            <strong className="mono">{formatCurrency(data.fromStatement.totals.principalPaid)}</strong> ·
            ריבית{" "}
            <strong className="mono text-warning">
              {formatCurrency(data.fromStatement.totals.interestPaid)}
            </strong>{" "}
            · ללא פירוט{" "}
            <strong className="mono">{formatCurrency(data.fromStatement.totals.unsplitPaid)}</strong> ·
            סה״כ הקטנת חוב{" "}
            <strong className="mono text-success">
              {formatCurrency(data.fromStatement.totals.debtReduction)}
            </strong>
          </div>
          <Table
            columns={statementColumns}
            rows={data.fromStatement.groups}
            rowKey={(row) => row.loanRef ?? row.label}
          />
        </Card>
      )}

      {/* ---------- Overlays ---------- */}
      {scheduleFor && <LoanScheduleDrawer loan={scheduleFor} onClose={() => setScheduleFor(null)} />}
      {quoteFor && (
        <EarlyRepaymentDialog
          loan={quoteFor}
          onClose={() => setQuoteFor(null)}
          onConfirmClose={setClosingLoan}
        />
      )}
      {closingLoan && (
        <CloseLoanDialog
          loan={closingLoan}
          onCancel={() => setClosingLoan(null)}
          onClosed={(event) => {
            setClosingLoan(null);
            setCelebrating(event);
            loansRes.reload();
          }}
        />
      )}
      {shownEvent && (
        <LoanCelebration
          event={shownEvent}
          remainingActive={active.length}
          onClose={() => {
            setCelebrating(null);
            loansRes.setData((current) => (current ? { ...current, events: [] } : current));
          }}
        />
      )}

      <Modal
        title={editing ? "עריכת הלוואה" : "הוספת הלוואה"}
        open={formOpen}
        onClose={() => setFormOpen(false)}
      >
        <form onSubmit={submit}>
          {error && <ErrorMessage message={error} />}
          {editing?.originalAmountSource === "reconstructed" && (
            <p className="settings-hint">
              הסכום המקורי כרגע משוחזר מלוח הסילוקין. הזנת הסכום מהחוזה תהפוך את אחוז הפירעון
              ממשוער למדויק.
            </p>
          )}
          <div className="form-row">
            <Input
              label="שם ההלוואה"
              required
              value={form.loanName}
              onChange={(e) => setForm({ ...form, loanName: e.target.value })}
            />
            <Select
              label="סוג"
              options={LOAN_TYPES}
              value={form.loanType}
              onChange={(e) => setForm({ ...form, loanType: e.target.value })}
            />
          </div>
          <div className="form-row">
            <Input
              label="גוף מלווה"
              value={form.lenderName ?? ""}
              onChange={(e) => setForm({ ...form, lenderName: e.target.value })}
            />
            <Input
              label="תאריך התחלה"
              type="date"
              required
              value={form.startDate}
              onChange={(e) => setForm({ ...form, startDate: e.target.value })}
            />
          </div>
          <div className="form-row">
            <Input
              label="סכום מקורי (₪)"
              type="number"
              step="0.01"
              min="1"
              required
              value={form.originalAmount || ""}
              onChange={(e) => setForm({ ...form, originalAmount: Number(e.target.value) })}
            />
            <Input
              label="יתרה נוכחית (₪)"
              type="number"
              step="0.01"
              min="0"
              required
              value={form.currentBalance || ""}
              onChange={(e) => setForm({ ...form, currentBalance: Number(e.target.value) })}
            />
          </div>
          <div className="form-row">
            <Input
              label="ריבית שנתית (%)"
              type="number"
              step="0.01"
              min="0"
              max="100"
              required
              value={form.annualInterestRate || ""}
              onChange={(e) => setForm({ ...form, annualInterestRate: Number(e.target.value) })}
            />
            <Input
              label="החזר חודשי (₪)"
              type="number"
              step="0.01"
              min="1"
              required
              value={form.monthlyPayment || ""}
              onChange={(e) => setForm({ ...form, monthlyPayment: Number(e.target.value) })}
            />
          </div>
          {editing && (
            <Select
              label="סטטוס"
              options={Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label }))}
              value={form.status ?? "active"}
              onChange={(e) => setForm({ ...form, status: e.target.value })}
            />
          )}
          <div className="modal-actions">
            <Button type="submit">{editing ? "עדכון" : "הוספה"}</Button>
            <Button type="button" variant="ghost" onClick={() => setFormOpen(false)}>
              ביטול
            </Button>
          </div>
        </form>
      </Modal>

      {confirm.dialog}
    </PageShell>
  );
}
