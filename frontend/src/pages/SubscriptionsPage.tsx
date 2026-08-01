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
  createSubscription,
  deleteSubscription,
  getSubscriptionCandidates,
  listSubscriptions,
  updateSubscription,
  type SubscriptionInput,
} from "../services/planning.service";
import type { Subscription, SubscriptionCandidate } from "../types/models";
import { formatCurrency, formatDate } from "../utils/format";

const emptyForm: SubscriptionInput = {
  name: "",
  amount: 0,
  billingDate: new Date().toISOString().slice(0, 10),
  frequency: "monthly",
};

export default function SubscriptionsPage() {
  // Two independent widgets: the detected-candidates card is a bonus, so its
  // failure must not hide the subscriptions the user already has (IA §1.3).
  const subs = useAsync(() => listSubscriptions(), [], "לא הצלחנו לטעון את המנויים");
  const candidatesRes = useAsync(
    () => getSubscriptionCandidates(),
    [],
    "לא הצלחנו לזהות מנויים אפשריים"
  );
  const confirm = useConfirm();
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Subscription | null>(null);
  const [form, setForm] = useState<SubscriptionInput>(emptyForm);
  const [error, setError] = useState("");

  const monthlyTotal = subs.data?.monthlyTotal ?? 0;

  function load() {
    subs.reload();
    candidatesRes.reload();
  }

  async function addCandidate(c: SubscriptionCandidate) {
    await createSubscription({
      name: c.name,
      amount: c.avgAmount,
      billingDate: c.nextBillingDate.slice(0, 10),
      frequency: "monthly",
    });
    load();
  }

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

  function askRemove(item: Subscription) {
    confirm.ask(
      {
        title: "מחיקת מנוי",
        message: (
          <>
            המנוי <strong>{item.name}</strong> יימחק.
            <span className="confirm-consequence">
              אם רק רצית להפסיק לשלם — עדיף להשהות אותו (⏸️), כך הוא נשמר בהיסטוריה.
            </span>
          </>
        ),
        confirmLabel: "מחיקה",
        tone: "danger",
      },
      async () => {
        await deleteSubscription(item.id);
        load();
      }
    );
  }

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
          <Button size="sm" variant="ghost" onClick={() => openEdit(row)} aria-label={`עריכת ${row.name}`}>✏️</Button>
          <Button size="sm" variant="ghost" onClick={() => askRemove(row)} aria-label={`מחיקת ${row.name}`}>🗑️</Button>
        </span>
      ),
    },
  ];

  const visibleCandidates = (candidatesRes.data ?? []).filter((c) => !dismissed.has(c.name));

  return (
    <>
      <div className="page-toolbar">
        <Button onClick={openCreate}>+ מנוי חדש</Button>
        <div className="toolbar-total">
          עלות חודשית: <strong className="mono text-danger">{formatCurrency(monthlyTotal)}</strong>
        </div>
      </div>

      {visibleCandidates.length > 0 && (
        <Card title={`🔎 זוהו ${visibleCandidates.length} מנויים אפשריים מדוחות האשראי`}>
          <p className="settings-hint">
            חיובים שחוזרים כל חודש (הוראות קבע וחיובים קבועים). הוסיפי בלחיצה כדי לעקוב אחריהם.
          </p>
          <div className="candidate-list">
            {visibleCandidates.map((c) => (
              <div key={c.name} className="candidate-card">
                <div className="candidate-info">
                  <span className="candidate-name">
                    {c.name}
                    {c.confidence === "high" && <span className="candidate-badge">הוראת קבע</span>}
                  </span>
                  <span className="candidate-reason text-muted">{c.reason}</span>
                </div>
                <span className="candidate-amount mono">{formatCurrency(c.avgAmount)}<span className="text-muted"> /חודש</span></span>
                <span className="row-actions">
                  <Button size="sm" onClick={() => addCandidate(c)}>+ הוסף</Button>
                  <Button size="sm" variant="ghost" onClick={() => setDismissed((s) => new Set(s).add(c.name))} title="התעלם">
                    ✕
                  </Button>
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card>
        <AsyncSection
          resource={subs}
          errorTitle="לא הצלחנו לטעון את המנויים"
          skeleton={<SkeletonRows rows={4} label="טוען מנויים" />}
        >
          {(data) => (
            <Table
              columns={columns}
              rows={data.items}
              rowKey={(row) => row.id}
              emptyState={<EmptyState icon="📺" title="אין מנויים" hint="נטפליקס, ספוטיפיי, חדר כושר — כאן רואים כמה זה עולה בחודש" />}
            />
          )}
        </AsyncSection>
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

      {confirm.dialog}
    </>
  );
}
