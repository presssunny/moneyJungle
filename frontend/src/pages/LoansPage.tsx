import { useState, type FormEvent } from "react";
import { AsyncSection } from "../components/common/AsyncSection";
import { Button } from "../components/common/Button";
import { Card } from "../components/common/Card";
import { useConfirm } from "../components/common/ConfirmDialog";
import { EmptyState } from "../components/common/EmptyState";
import { ErrorMessage } from "../components/common/ErrorMessage";
import { Input } from "../components/common/Input";
import { Modal } from "../components/common/Modal";
import { Select } from "../components/common/Select";
import { SkeletonRows } from "../components/common/Skeleton";
import { Table, type Column } from "../components/common/Table";
import { useAsync } from "../hooks/useAsync";
import { apiErrorMessage } from "../services/api";
import {
  createLoan,
  deleteLoan,
  getLoanSchedule,
  listLoans,
  updateLoan,
  type LoanInput,
} from "../services/finance.service";
import type { StatementLoanGroup } from "../services/planning.service";
import type { Loan, LoanScheduleRow } from "../types/models";
import { formatCurrency } from "../utils/format";

const LOAN_TYPES = [
  { value: "bank", label: "בנק" },
  { value: "credit", label: "אשראי" },
  { value: "car", label: "רכב" },
  { value: "mortgage", label: "משכנתא" },
  { value: "private", label: "פרטית" },
  { value: "other", label: "אחר" },
];

const STATUS_LABELS: Record<string, string> = { active: "פעילה", finished: "הסתיימה", overdue: "בפיגור" };

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

export default function LoansPage() {
  const loansRes = useAsync(() => listLoans(), [], "לא הצלחנו לטעון את ההלוואות");
  const confirm = useConfirm();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Loan | null>(null);
  const [form, setForm] = useState<LoanInput>(emptyForm);
  const [error, setError] = useState("");
  const [schedule, setSchedule] = useState<{ loan: Loan; rows: LoanScheduleRow[] } | null>(null);

  const load = loansRes.reload;
  const totals = loansRes.data?.totals ?? null;
  const fromStatement = loansRes.data?.fromStatement ?? null;

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
      load();
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  }

  function remove(loan: Loan) {
    confirm.ask(
      {
        title: "מחיקת הלוואה",
        message: (
          <>
            ההלוואה <strong>{loan.loanName}</strong> תימחק.
            <span className="confirm-consequence">
              היתרה, ההחזר החודשי והריבית שלה ייעלמו מהדשבורד, מהתובנות ומתחזית התזרים.
              תשלומים שכבר מופיעים בדוח הבנק יישארו — הם נלקחים משם, לא מכאן.
            </span>
          </>
        ),
        confirmLabel: "מחיקה",
        tone: "danger",
      },
      async () => {
        await deleteLoan(loan.id);
        load();
      }
    );
  }

  async function showSchedule(loan: Loan) {
    const rows = await getLoanSchedule(loan.id);
    setSchedule({ loan, rows });
  }

  const columns: Column<Loan>[] = [
    {
      key: "name",
      header: "הלוואה",
      render: (row) => (
        <span>
          {row.computed.isExpensive && <span title="ריבית גבוהה">🔥 </span>}
          <strong>{row.loanName}</strong>
          {row.lenderName && <span className="text-muted"> · {row.lenderName}</span>}
        </span>
      ),
    },
    { key: "type", header: "סוג", render: (row) => LOAN_TYPES.find((t) => t.value === row.loanType)?.label ?? row.loanType },
    {
      key: "balance",
      header: "יתרה",
      align: "left",
      render: (row) => <span className="mono">{formatCurrency(row.currentBalance)}</span>,
    },
    {
      key: "payment",
      header: "החזר חודשי",
      align: "left",
      render: (row) => <span className="mono">{formatCurrency(row.monthlyPayment)}</span>,
    },
    {
      key: "rate",
      header: "ריבית שנתית",
      align: "left",
      render: (row) => (
        <span className={`mono ${row.computed.isExpensive ? "text-danger" : ""}`}>{row.annualInterestRate}%</span>
      ),
    },
    {
      key: "interest",
      header: "ריבית חודשית",
      align: "left",
      render: (row) => <span className="mono text-warning">{formatCurrency(row.computed.monthlyInterestPayment)}</span>,
    },
    {
      key: "months",
      header: "חודשים שנותרו",
      align: "center",
      render: (row) => (row.computed.remainingMonths !== null ? row.computed.remainingMonths : <span className="text-danger" title="ההחזר לא מכסה את הריבית">∞</span>),
    },
    { key: "status", header: "סטטוס", render: (row) => STATUS_LABELS[row.status] ?? row.status },
    {
      key: "actions",
      header: "",
      align: "left",
      render: (row) => (
        <span className="row-actions">
          <Button size="sm" variant="ghost" onClick={() => showSchedule(row)} title="לוח סילוקין">📋</Button>
          <Button size="sm" variant="ghost" onClick={() => openEdit(row)}>✏️</Button>
          <Button size="sm" variant="ghost" onClick={() => remove(row)}>🗑️</Button>
        </span>
      ),
    },
  ];

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
      render: (row) => (
        <span className="mono text-warning">{formatCurrency(row.interestPaid)}</span>
      ),
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
    <>
      <div className="page-toolbar">
        <Button onClick={openCreate}>+ הוספת הלוואה</Button>
        {totals && totals.activeCount > 0 && (
          <div className="toolbar-total">
            יתרה כוללת <strong className="mono">{formatCurrency(totals.totalBalance)}</strong> · החזר חודשי{" "}
            <strong className="mono">{formatCurrency(totals.monthlyPayment)}</strong> · ריבית חודשית{" "}
            <strong className="mono text-warning">{formatCurrency(totals.monthlyInterest)}</strong>
          </div>
        )}
      </div>

      <Card>
        <AsyncSection
          resource={loansRes}
          errorTitle="לא הצלחנו לטעון את ההלוואות"
          skeleton={<SkeletonRows rows={3} label="טוען הלוואות" />}
        >
          {(data) => (
            <Table
              columns={columns}
              rows={data.loans}
              rowKey={(row) => row.id}
              emptyState={<EmptyState icon="📉" title="אין הלוואות" hint="הוסיפי הלוואה כדי לעקוב אחרי ריביות והחזרים" />}
            />
          )}
        </AsyncSection>
      </Card>

      {fromStatement && fromStatement.groups.length > 0 && (
        <Card title="תשלומי הלוואות לפי הדוח הבנקאי">
          <p className="text-muted">
            הסכומים כאן הם השורות של הבנק עצמו, לא תחזית: קרן שכבר שולמה (הקטנת חוב — לא הוצאה),
            ריבית שנגבתה (הוצאה מימונית) ותשלומים שהדוח לא פיצל בין קרן לריבית. הלוואה שלא הוגדרה
            למעלה עדיין מופיעה כאן, כדי שהתשלומים שלה לא ייעלמו.
          </p>
          <div className="toolbar-total">
            קרן ששולמה <strong className="mono">{formatCurrency(fromStatement.totals.principalPaid)}</strong> · ריבית{" "}
            <strong className="mono text-warning">{formatCurrency(fromStatement.totals.interestPaid)}</strong> · ללא
            פירוט <strong className="mono">{formatCurrency(fromStatement.totals.unsplitPaid)}</strong> · סה״כ הקטנת חוב{" "}
            <strong className="mono text-success">{formatCurrency(fromStatement.totals.debtReduction)}</strong>
          </div>
          <Table
            columns={statementColumns}
            rows={fromStatement.groups}
            rowKey={(row) => row.loanRef ?? row.label}
          />
        </Card>
      )}

      <Modal title={editing ? "עריכת הלוואה" : "הוספת הלוואה"} open={formOpen} onClose={() => setFormOpen(false)}>
        <form onSubmit={submit}>
          {error && <ErrorMessage message={error} />}
          <div className="form-row">
            <Input label="שם ההלוואה" required value={form.loanName} onChange={(e) => setForm({ ...form, loanName: e.target.value })} />
            <Select label="סוג" options={LOAN_TYPES} value={form.loanType} onChange={(e) => setForm({ ...form, loanType: e.target.value })} />
          </div>
          <div className="form-row">
            <Input label="גוף מלווה" value={form.lenderName ?? ""} onChange={(e) => setForm({ ...form, lenderName: e.target.value })} />
            <Input label="תאריך התחלה" type="date" required value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
          </div>
          <div className="form-row">
            <Input label="סכום מקורי (₪)" type="number" step="0.01" min="1" required value={form.originalAmount || ""} onChange={(e) => setForm({ ...form, originalAmount: Number(e.target.value) })} />
            <Input label="יתרה נוכחית (₪)" type="number" step="0.01" min="0" required value={form.currentBalance || ""} onChange={(e) => setForm({ ...form, currentBalance: Number(e.target.value) })} />
          </div>
          <div className="form-row">
            <Input label="ריבית שנתית (%)" type="number" step="0.01" min="0" max="100" required value={form.annualInterestRate || ""} onChange={(e) => setForm({ ...form, annualInterestRate: Number(e.target.value) })} />
            <Input label="החזר חודשי (₪)" type="number" step="0.01" min="1" required value={form.monthlyPayment || ""} onChange={(e) => setForm({ ...form, monthlyPayment: Number(e.target.value) })} />
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
            <Button type="button" variant="ghost" onClick={() => setFormOpen(false)}>ביטול</Button>
          </div>
        </form>
      </Modal>

      <Modal
        title={schedule ? `לוח סילוקין — ${schedule.loan.loanName}` : ""}
        open={schedule !== null}
        onClose={() => setSchedule(null)}
      >
        {schedule && (
          <Table
            columns={[
              { key: "n", header: "חודש", render: (r: LoanScheduleRow) => r.month },
              { key: "interest", header: "ריבית", align: "left", render: (r: LoanScheduleRow) => <span className="mono text-warning">{formatCurrency(r.interest)}</span> },
              { key: "principal", header: "קרן", align: "left", render: (r: LoanScheduleRow) => <span className="mono">{formatCurrency(r.principal)}</span> },
              { key: "balance", header: "יתרה", align: "left", render: (r: LoanScheduleRow) => <span className="mono">{formatCurrency(r.balance)}</span> },
            ]}
            rows={schedule.rows}
            rowKey={(r) => r.month}
          />
        )}
      </Modal>

      {confirm.dialog}
    </>
  );
}
