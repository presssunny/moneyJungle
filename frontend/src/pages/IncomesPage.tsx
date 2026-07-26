import { useState, type FormEvent } from "react";
import { AsyncSection } from "../components/common/AsyncSection";
import { Button } from "../components/common/Button";
import { Card } from "../components/common/Card";
import { EmptyState } from "../components/common/EmptyState";
import { ErrorMessage } from "../components/common/ErrorMessage";
import { Input } from "../components/common/Input";
import { Modal } from "../components/common/Modal";
import { Select } from "../components/common/Select";
import { SkeletonRows } from "../components/common/Skeleton";
import { Table, type Column } from "../components/common/Table";
import { useMonth } from "../context/MonthContext";
import { useAsync } from "../hooks/useAsync";
import { apiErrorMessage } from "../services/api";
import { createIncome, deleteIncome, listIncomes, updateIncome, type IncomeInput } from "../services/finance.service";
import type { Income } from "../types/models";
import { formatCurrency, formatDate } from "../utils/format";

const INCOME_TYPES = [
  { value: "salary", label: "משכורת" },
  { value: "extra", label: "תוספת" },
  { value: "business", label: "עסק" },
  { value: "allowance", label: "קצבה" },
  { value: "refund", label: "החזר" },
  { value: "gift", label: "מתנה" },
  { value: "one_time", label: "חד־פעמי" },
  { value: "recurring", label: "קבוע" },
];

const typeLabel = (type: string) => INCOME_TYPES.find((t) => t.value === type)?.label ?? type;

const emptyForm = (monthKey: string): IncomeInput => ({
  amount: 0,
  type: "salary",
  description: "",
  incomeDate: `${monthKey}-01`,
});

export default function IncomesPage() {
  const { monthKey } = useMonth();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Income | null>(null);
  const [form, setForm] = useState<IncomeInput>(emptyForm(monthKey));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const incomesRes = useAsync(() => listIncomes(monthKey), [monthKey, reloadKey], "לא הצלחנו לטעון את ההכנסות");
  const load = () => setReloadKey((k) => k + 1);
  const total = incomesRes.data?.total ?? 0;

  function openCreate() {
    setEditing(null);
    setForm(emptyForm(monthKey));
    setError("");
    setFormOpen(true);
  }

  function openEdit(income: Income) {
    setEditing(income);
    setForm({
      amount: Number(income.amount),
      type: income.type,
      description: income.description ?? "",
      incomeDate: income.incomeDate.slice(0, 10),
      isRecurring: income.isRecurring,
    });
    setError("");
    setFormOpen(true);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const payload = { ...form, description: form.description || null };
      if (editing) await updateIncome(editing.id, payload);
      else await createIncome(payload);
      setFormOpen(false);
      load();
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function remove(income: Income) {
    if (!window.confirm(`למחוק את ההכנסה "${income.description || typeLabel(income.type)}"?`)) return;
    await deleteIncome(income.id);
    load();
  }

  const columns: Column<Income>[] = [
    { key: "date", header: "תאריך", render: (row) => formatDate(row.incomeDate) },
    { key: "desc", header: "תיאור", render: (row) => row.description || "—" },
    { key: "type", header: "סוג", render: (row) => typeLabel(row.type) },
    {
      key: "amount",
      header: "סכום",
      align: "left",
      render: (row) => <span className="mono text-success">{formatCurrency(Number(row.amount))}</span>,
    },
    {
      key: "actions",
      header: "",
      align: "left",
      render: (row) => (
        <span className="row-actions">
          <Button size="sm" variant="ghost" onClick={() => openEdit(row)} aria-label="עריכה">✏️</Button>
          <Button size="sm" variant="ghost" onClick={() => remove(row)} aria-label="מחיקה">🗑️</Button>
        </span>
      ),
    },
  ];

  return (
    <>
      <div className="page-toolbar">
        <Button onClick={openCreate}>+ הוספת הכנסה</Button>
        <div className="toolbar-total">
          סה״כ החודש: <strong className="mono text-success">{formatCurrency(total)}</strong>
        </div>
      </div>

      <Card>
        <AsyncSection
          resource={incomesRes}
          errorTitle="לא הצלחנו לטעון את ההכנסות"
          skeleton={<SkeletonRows rows={5} />}
        >
          {(data) => (
            <Table
              columns={columns}
              rows={data.incomes}
              rowKey={(row) => row.id}
              emptyState={
                <EmptyState
                  icon="💰"
                  title="אין הכנסות החודש"
                  hint="הוסיפי משכורת, קצבה או כל הכנסה אחרת"
                  action={
                    <Button size="sm" onClick={openCreate}>
                      + הוספת הכנסה
                    </Button>
                  }
                />
              }
            />
          )}
        </AsyncSection>
      </Card>

      <Modal title={editing ? "עריכת הכנסה" : "הוספת הכנסה"} open={formOpen} onClose={() => setFormOpen(false)}>
        <form onSubmit={submit}>
          {error && <ErrorMessage message={error} />}
          <div className="form-row">
            <Input
              label="סכום (₪)"
              type="number"
              step="0.01"
              min="0.01"
              required
              value={form.amount || ""}
              onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })}
            />
            <Input
              label="תאריך"
              type="date"
              required
              value={form.incomeDate}
              onChange={(e) => setForm({ ...form, incomeDate: e.target.value })}
            />
          </div>
          <div className="form-row">
            <Select
              label="סוג הכנסה"
              options={INCOME_TYPES}
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value })}
            />
            <Input
              label="תיאור"
              value={form.description ?? ""}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>
          <div className="modal-actions">
            <Button type="submit" disabled={saving}>
              {saving ? "שומר..." : editing ? "עדכון" : "הוספה"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setFormOpen(false)}>
              ביטול
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
