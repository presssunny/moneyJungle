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
  createPaymentMethod,
  deletePaymentMethod,
  listPaymentMethods,
  updatePaymentMethod,
} from "../services/planning.service";
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
  const [methods, setMethods] = useState<PaymentMethod[] | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<PaymentMethod | null>(null);
  const [form, setForm] = useState({ name: "", type: "credit_card" });
  const [error, setError] = useState("");

  const load = useCallback(() => {
    listPaymentMethods().then(setMethods).catch(() => setMethods([]));
  }, []);

  useEffect(load, [load]);

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
      load();
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  }

  async function remove(method: PaymentMethod) {
    if (!window.confirm(`למחוק את אמצעי התשלום "${method.name}"?`)) return;
    try {
      await deletePaymentMethod(method.id);
      load();
    } catch (err) {
      window.alert(apiErrorMessage(err));
    }
  }

  if (!methods) return <Loading />;

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
            <Button size="sm" variant="ghost" onClick={() => openEdit(row)}>✏️</Button>
            <Button size="sm" variant="ghost" onClick={() => remove(row)}>🗑️</Button>
          </span>
        ) : null,
    },
  ];

  return (
    <>
      <div className="page-toolbar">
        <Button onClick={openCreate}>+ אמצעי תשלום</Button>
      </div>

      <Card>
        <Table
          columns={columns}
          rows={methods}
          rowKey={(row) => row.id}
          emptyState={<EmptyState icon="💼" title="אין אמצעי תשלום" />}
        />
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
    </>
  );
}
