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
import { useAsync } from "../hooks/useAsync";
import { apiErrorMessage } from "../services/api";
import {
  createPaymentMethod,
  deletePaymentMethod,
  listPaymentMethods,
  updatePaymentMethod,
} from "../services/planning.service";
import { toast } from "../services/toast";
import type { PaymentMethod } from "../types/models";

const METHOD_TYPES = [
  { value: "cash", label: "מזומן" },
  { value: "credit_card", label: "כרטיס אשראי" },
  { value: "credit_installments", label: "אשראי בתשלומים" },
  { value: "bank_transfer", label: "העברה בנקאית" },
  { value: "bit", label: "ביט" },
  { value: "paybox", label: "פייבוקס" },
  { value: "standing_order", label: "הוראת קבע" },
  { value: "check", label: "צ'ק" },
];

const typeLabel = (type: string) => METHOD_TYPES.find((t) => t.value === type)?.label ?? type;

export default function PaymentMethodsPage() {
  const methods = useAsync(() => listPaymentMethods(), [], "לא הצלחנו לטעון את אמצעי התשלום");
  const confirm = useConfirm();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<PaymentMethod | null>(null);
  const [form, setForm] = useState({ name: "", type: "credit_card" });
  const [error, setError] = useState("");

  function openCreate() {
    setEditing(null);
    setForm({ name: "", type: "credit_card" });
    setError("");
    setFormOpen(true);
  }

  function openEdit(method: PaymentMethod) {
    setEditing(method);
    setForm({ name: method.name, type: method.type });
    setError("");
    setFormOpen(true);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      if (editing) await updatePaymentMethod(editing.id, form);
      else await createPaymentMethod(form);
      setFormOpen(false);
      methods.reload();
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  }

  function askRemove(method: PaymentMethod) {
    confirm.ask(
      {
        title: "מחיקת אמצעי תשלום",
        message: (
          <>
            <strong>{method.name}</strong> יימחק.
            <span className="confirm-consequence">
              תנועות שכבר שויכו אליו יישארו — הן פשוט לא יציגו אמצעי תשלום.
            </span>
          </>
        ),
        confirmLabel: "מחיקה",
        tone: "danger",
      },
      async () => {
        try {
          await deletePaymentMethod(method.id);
          methods.reload();
        } catch (err) {
          toast.error(apiErrorMessage(err));
        }
      }
    );
  }

  const columns: Column<PaymentMethod>[] = [
    { key: "name", header: "שם", render: (row) => <strong>{row.name}</strong> },
    { key: "type", header: "סוג", render: (row) => typeLabel(row.type) },
    {
      key: "scope",
      header: "מקור",
      render: (row) => (row.userId === null ? <span className="text-muted">ברירת מחדל</span> : "שלי"),
    },
    {
      key: "actions",
      header: "",
      align: "left",
      render: (row) =>
        row.userId !== null ? (
          <span className="row-actions">
            <Button size="sm" variant="ghost" onClick={() => openEdit(row)} aria-label={`עריכת ${row.name}`}>✏️</Button>
            <Button size="sm" variant="ghost" onClick={() => askRemove(row)} aria-label={`מחיקת ${row.name}`}>🗑️</Button>
          </span>
        ) : null,
    },
  ];

  return (
    <PageShell
      toolbar={<Button onClick={openCreate}>+ אמצעי תשלום</Button>}
      summary={
        <AsyncSection
          resource={methods}
          errorTitle="לא הצלחנו לטעון את סיכום אמצעי התשלום"
          skeleton={<SkeletonKpiRow count={3} label="טוען סיכום" />}
        >
          {(rows) => (
            <div className="kpi-row">
              <SummaryCard label="אמצעי תשלום" value={String(rows.length)} icon="💼" />
              <SummaryCard
                label="שהוספתי"
                value={String(rows.filter((m) => m.userId !== null).length)}
                icon="✏️"
              />
              <SummaryCard
                label="ברירת מחדל"
                value={String(rows.filter((m) => m.userId === null).length)}
                icon="🔒"
                sub="לא ניתנים למחיקה"
              />
            </div>
          )}
        </AsyncSection>
      }
    >
      <Card>
        <AsyncSection
          resource={methods}
          errorTitle="לא הצלחנו לטעון את אמצעי התשלום"
          skeleton={<SkeletonRows rows={4} />}
        >
          {(rows) => (
            <Table
              columns={columns}
              rows={rows}
              rowKey={(row) => row.id}
              emptyState={<EmptyState icon="💼" title="אין אמצעי תשלום" />}
            />
          )}
        </AsyncSection>
      </Card>

      <Modal title={editing ? "עריכת אמצעי תשלום" : "אמצעי תשלום חדש"} open={formOpen} onClose={() => setFormOpen(false)}>
        <form onSubmit={submit}>
          {error && <ErrorMessage message={error} />}
          <div className="form-row">
            <Input label="שם" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <Select label="סוג" options={METHOD_TYPES} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} />
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
