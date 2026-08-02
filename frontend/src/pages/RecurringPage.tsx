import { useState, type FormEvent } from "react";
import { AsyncSection } from "../components/common/AsyncSection";
import { Button } from "../components/common/Button";
import { Card } from "../components/common/Card";
import { useConfirm } from "../components/common/ConfirmDialog";
import { EmptyState } from "../components/common/EmptyState";
import { ErrorMessage } from "../components/common/ErrorMessage";
import { Input } from "../components/common/Input";
import { Modal } from "../components/common/Modal";
import { PageShell } from "../components/common/PageShell";
import { Select } from "../components/common/Select";
import { SkeletonKpiRow, SkeletonRows } from "../components/common/Skeleton";
import { Table, type Column } from "../components/common/Table";
import { SummaryCard } from "../components/dashboard/SummaryCard";
import { useMonth } from "../context/MonthContext";
import { useAsync } from "../hooks/useAsync";
import { useLookups } from "../hooks/useLookups";
import { apiErrorMessage } from "../services/api";
import {
  createRecurring,
  deleteRecurring,
  generateRecurring,
  listRecurring,
  updateRecurring,
  type RecurringInput,
} from "../services/planning.service";
import type { RecurringPayment } from "../types/models";
import { formatCurrency, formatDate, formatMonthKey } from "../utils/format";

const FREQUENCIES = [
  { value: "monthly", label: "חודשי" },
  { value: "yearly", label: "שנתי" },
];

const emptyForm: RecurringInput = {
  name: "",
  amount: 0,
  categoryId: null,
  paymentMethodId: null,
  frequency: "monthly",
  nextPaymentDate: new Date().toISOString().slice(0, 10),
};

export default function RecurringPage() {
  const { monthKey } = useMonth();
  const { expenseCategories, paymentMethods } = useLookups();
  const recurring = useAsync(() => listRecurring(), [], "לא הצלחנו לטעון את התשלומים הקבועים");
  const confirm = useConfirm();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<RecurringPayment | null>(null);
  const [form, setForm] = useState<RecurringInput>(emptyForm);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = recurring.reload;

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setError("");
    setFormOpen(true);
  }

  function openEdit(item: RecurringPayment) {
    setEditing(item);
    setForm({
      name: item.name,
      amount: Number(item.amount),
      categoryId: item.categoryId,
      paymentMethodId: item.paymentMethodId,
      frequency: item.frequency,
      nextPaymentDate: item.nextPaymentDate.slice(0, 10),
    });
    setError("");
    setFormOpen(true);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      if (editing) await updateRecurring(editing.id, form);
      else await createRecurring(form);
      setFormOpen(false);
      load();
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  }

  function askRemove(item: RecurringPayment) {
    confirm.ask(
      {
        title: "מחיקת תשלום קבוע",
        message: (
          <>
            התשלום הקבוע <strong>{item.name}</strong> יימחק מהתוכנית החודשית.
            <span className="confirm-consequence">
              הוצאות שכבר נוצרו ממנו בחודשים קודמים יישארו — נמחקת רק התוכנית להבא.
            </span>
          </>
        ),
        confirmLabel: "מחיקה",
        tone: "danger",
      },
      async () => {
        await deleteRecurring(item.id);
        load();
      }
    );
  }

  async function generate() {
    setMessage("");
    try {
      const result = await generateRecurring(monthKey);
      setMessage(
        result.created > 0
          ? `נוצרו ${result.created} הוצאות לחודש ${formatMonthKey(monthKey)} (${result.skipped} כבר קיימות)`
          : `כל התשלומים הקבועים כבר קיימים כהוצאות ב${formatMonthKey(monthKey)}`
      );
    } catch (err) {
      setMessage(apiErrorMessage(err));
    }
  }

  const columns: Column<RecurringPayment>[] = [
    { key: "name", header: "שם", render: (row) => <strong>{row.name}</strong> },
    {
      key: "amount",
      header: "סכום",
      align: "left",
      render: (row) => <span className="mono text-danger">{formatCurrency(Number(row.amount))}</span>,
    },
    {
      key: "category",
      header: "קטגוריה",
      render: (row) => (row.category ? `${row.category.icon ?? ""} ${row.category.name}` : <span className="text-muted">—</span>),
    },
    { key: "method", header: "אמצעי תשלום", render: (row) => row.paymentMethod?.name ?? "—" },
    { key: "freq", header: "תדירות", render: (row) => FREQUENCIES.find((f) => f.value === row.frequency)?.label ?? row.frequency },
    { key: "next", header: "תשלום הבא", render: (row) => formatDate(row.nextPaymentDate) },
    {
      key: "actions",
      header: "",
      align: "left",
      render: (row) => (
        <span className="row-actions">
          <Button size="sm" variant="ghost" onClick={() => openEdit(row)} aria-label={`עריכת ${row.name}`}>✏️</Button>
          <Button size="sm" variant="ghost" onClick={() => askRemove(row)} aria-label={`מחיקת ${row.name}`}>🗑️</Button>
        </span>
      ),
    },
  ];

  const items = recurring.data?.items ?? [];
  // Next payment due, so the screen answers "what is about to leave the account?"
  // and not only "what did I set up?".
  const nextDue = items
    .map((item) => item.nextPaymentDate)
    .sort()
    .find(() => true);

  return (
    <PageShell
      toolbar={
        <>
          <Button onClick={openCreate}>+ תשלום קבוע</Button>
          <Button variant="outline" onClick={generate}>
            יצירת הוצאות החודש ⚡
          </Button>
        </>
      }
      summary={
        <AsyncSection
          resource={recurring}
          errorTitle="לא הצלחנו לטעון את סיכום התשלומים הקבועים"
          skeleton={<SkeletonKpiRow count={3} label="טוען סיכום" />}
        >
          {(data) => (
            <div className="kpi-row">
              <SummaryCard label="תשלומים קבועים" value={String(data.items.length)} icon="🔁" />
              <SummaryCard
                label="סה״כ חודשי"
                value={formatCurrency(data.monthlyTotal)}
                icon="💸"
                tone="danger"
                sub={`מתוך התוכנית של ${formatMonthKey(monthKey)}`}
              />
              <SummaryCard
                label="התשלום הקרוב"
                value={nextDue ? formatDate(nextDue) : "—"}
                icon="📅"
              />
            </div>
          )}
        </AsyncSection>
      }
    >
      {message && <div className="info-banner">{message}</div>}

      <Card>
        <AsyncSection
          resource={recurring}
          errorTitle="לא הצלחנו לטעון את התשלומים הקבועים"
          skeleton={<SkeletonRows rows={5} label="טוען תשלומים קבועים" />}
        >
          {(data) => (
            <Table
              columns={columns}
              rows={data.items}
              rowKey={(row) => row.id}
              emptyState={<EmptyState icon="🔁" title="אין תשלומים קבועים" hint='למשל: שכר דירה, גן, ביטוחים — כמו בגיליון האקסל המשפחתי' />}
            />
          )}
        </AsyncSection>
      </Card>

      <Modal title={editing ? "עריכת תשלום קבוע" : "תשלום קבוע חדש"} open={formOpen} onClose={() => setFormOpen(false)}>
        <form onSubmit={submit}>
          {error && <ErrorMessage message={error} />}
          <div className="form-row">
            <Input label="שם" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <Input
              label="סכום (₪)"
              type="number"
              step="0.01"
              min="0.01"
              required
              value={form.amount || ""}
              onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })}
            />
          </div>
          <div className="form-row">
            <Select
              label="קטגוריה"
              options={expenseCategories.map((c) => ({ value: c.id, label: `${c.icon ?? ""} ${c.name}` }))}
              placeholder="ללא"
              value={form.categoryId ?? ""}
              onChange={(e) => setForm({ ...form, categoryId: e.target.value ? Number(e.target.value) : null })}
            />
            <Select
              label="אמצעי תשלום"
              options={paymentMethods.map((m) => ({ value: m.id, label: m.name }))}
              placeholder="ללא"
              value={form.paymentMethodId ?? ""}
              onChange={(e) => setForm({ ...form, paymentMethodId: e.target.value ? Number(e.target.value) : null })}
            />
          </div>
          <div className="form-row">
            <Select
              label="תדירות"
              options={FREQUENCIES}
              value={form.frequency}
              onChange={(e) => setForm({ ...form, frequency: e.target.value })}
            />
            <Input
              label="תאריך תשלום הבא"
              type="date"
              required
              value={form.nextPaymentDate}
              onChange={(e) => setForm({ ...form, nextPaymentDate: e.target.value })}
            />
          </div>
          <div className="modal-actions">
            <Button type="submit">{editing ? "עדכון" : "הוספה"}</Button>
            <Button type="button" variant="ghost" onClick={() => setFormOpen(false)}>ביטול</Button>
          </div>
        </form>
      </Modal>

      {confirm.dialog}
    </PageShell>
  );
}
