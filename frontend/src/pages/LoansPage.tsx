import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Button } from "../components/common/Button";
import { Card } from "../components/common/Card";
import { EmptyState } from "../components/common/EmptyState";
import { ErrorMessage } from "../components/common/ErrorMessage";
import { Input } from "../components/common/Input";
import { Loading } from "../components/common/Loading";
import { Modal } from "../components/common/Modal";
import { Select } from "../components/common/Select";
import { Table, type Column } from "../components/common/Table";
import { apiErrorMessage } from "../services/api";
import {
  createLoan,
  deleteLoan,
  getLoanSchedule,
  listLoans,
  updateLoan,
  type LoanInput,
} from "../services/finance.service";
import type { Loan, LoanScheduleRow, LoanTotals } from "../types/models";
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
  const [loans, setLoans] = useState<Loan[] | null>(null);
  const [totals, setTotals] = useState<LoanTotals | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Loan | null>(null);
  const [form, setForm] = useState<LoanInput>(emptyForm);
  const [error, setError] = useState("");
  const [schedule, setSchedule] = useState<{ loan: Loan; rows: LoanScheduleRow[] } | null>(null);

  const load = useCallback(() => {
    listLoans()
      .then((data) => {
        setLoans(data.loans);
        setTotals(data.totals);
      })
      .catch(() => setLoans([]));
  }, []);

  useEffect(load, [load]);

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

  async function remove(loan: Loan) {
    if (!window.confirm(`למחוק את ההלוואה "${loan.loanName}"?`)) return;
    await deleteLoan(loan.id);
    load();
  }

  async function showSchedule(loan: Loan) {
    const rows = await getLoanSchedule(loan.id);
    setSchedule({ loan, rows });
  }

  if (!loans) return <Loading />;

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
        <Table
          columns={columns}
          rows={loans}
          rowKey={(row) => row.id}
          emptyState={<EmptyState icon="📉" title="אין הלוואות" hint="הוסיפי הלוואה כדי לעקוב אחרי ריביות והחזרים" />}
        />
      </Card>

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
    </>
  );
}
