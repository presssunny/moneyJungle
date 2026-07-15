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
  createSubscription,
  deleteSubscription,
  listSubscriptions,
  updateSubscription,
  type SubscriptionInput,
} from "../services/planning.service";
import type { Subscription } from "../types/models";
import { formatCurrency, formatDate } from "../utils/format";

const emptyForm: SubscriptionInput = {
  name: "",
  amount: 0,
  billingDate: new Date().toISOString().slice(0, 10),
  frequency: "monthly",
};

export default function SubscriptionsPage() {
  const [items, setItems] = useState<Subscription[] | null>(null);
  const [monthlyTotal, setMonthlyTotal] = useState(0);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Subscription | null>(null);
  const [form, setForm] = useState<SubscriptionInput>(emptyForm);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    listSubscriptions()
      .then((data) => {
        setItems(data.items);
        setMonthlyTotal(data.monthlyTotal);
      })
      .catch(() => setItems([]));
  }, []);

  useEffect(load, [load]);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setError("");
    setFormOpen(true);
  }

  function openEdit(item: Subscription) {
    setEditing(item);
    setForm({
      name: item.name,
      amount: Number(item.amount),
      billingDate: item.billingDate.slice(0, 10),
      frequency: item.frequency,
      status: item.status,
    });
    setError("");
    setFormOpen(true);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      if (editing) await updateSubscription(editing.id, form);
      else await createSubscription(form);
      setFormOpen(false);
      load();
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  }

  async function toggleStatus(item: Subscription) {
    await updateSubscription(item.id, { status: item.status === "active" ? "inactive" : "active" });
    load();
  }

  async function remove(item: Subscription) {
    if (!window.confirm(`למחוק את המנוי "${item.name}"?`)) return;
    await deleteSubscription(item.id);
    load();
  }

  if (!items) return <Loading />;

  const columns: Column<Subscription>[] = [
    {
      key: "name",
      header: "מנוי",
      render: (row) => (
        <span className={row.status === "inactive" ? "text-muted" : ""}>
          <strong>{row.name}</strong>
        </span>
      ),
    },
    {
      key: "amount",
      header: "סכום",
      align: "left",
      render: (row) => <span className="mono">{formatCurrency(Number(row.amount))}</span>,
    },
    { key: "freq", header: "תדירות", render: (row) => (row.frequency === "yearly" ? "שנתי" : "חודשי") },
    { key: "billing", header: "חיוב הבא", render: (row) => formatDate(row.billingDate) },
    {
      key: "status",
      header: "סטטוס",
      render: (row) =>
        row.status === "active" ? <span className="text-success">פעיל</span> : <span className="text-muted">מושהה</span>,
    },
    {
      key: "actions",
      header: "",
      align: "left",
      render: (row) => (
        <span className="row-actions">
          <Button size="sm" variant="ghost" onClick={() => toggleStatus(row)} title={row.status === "active" ? "השהיה" : "הפעלה"}>
            {row.status === "active" ? "⏸️" : "▶️"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => openEdit(row)}>✏️</Button>
          <Button size="sm" variant="ghost" onClick={() => remove(row)}>🗑️</Button>
        </span>
      ),
    },
  ];

  return (
    <>
      <div className="page-toolbar">
        <Button onClick={openCreate}>+ מנוי חדש</Button>
        <div className="toolbar-total">
          עלות חודשית: <strong className="mono text-danger">{formatCurrency(monthlyTotal)}</strong>
        </div>
      </div>

      <Card>
        <Table
          columns={columns}
          rows={items}
          rowKey={(row) => row.id}
          emptyState={<EmptyState icon="📺" title="אין מנויים" hint="נטפליקס, ספוטיפיי, חדר כושר — כאן רואים כמה זה עולה בחודש" />}
        />
      </Card>

      <Modal title={editing ? "עריכת מנוי" : "מנוי חדש"} open={formOpen} onClose={() => setFormOpen(false)}>
        <form onSubmit={submit}>
          {error && <ErrorMessage message={error} />}
          <div className="form-row">
            <Input label="שם המנוי" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
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
              label="תדירות"
              options={[{ value: "monthly", label: "חודשי" }, { value: "yearly", label: "שנתי" }]}
              value={form.frequency}
              onChange={(e) => setForm({ ...form, frequency: e.target.value })}
            />
            <Input
              label="תאריך חיוב הבא"
              type="date"
              required
              value={form.billingDate}
              onChange={(e) => setForm({ ...form, billingDate: e.target.value })}
            />
          </div>
          <div className="modal-actions">
            <Button type="submit">{editing ? "עדכון" : "הוספה"}</Button>
            <Button type="button" variant="ghost" onClick={() => setFormOpen(false)}>ביטול</Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
