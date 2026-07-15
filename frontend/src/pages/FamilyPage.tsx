import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Button } from "../components/common/Button";
import { Card } from "../components/common/Card";
import { EmptyState } from "../components/common/EmptyState";
import { ErrorMessage } from "../components/common/ErrorMessage";
import { Input } from "../components/common/Input";
import { Loading } from "../components/common/Loading";
import { Modal } from "../components/common/Modal";
import { Table, type Column } from "../components/common/Table";
import { apiErrorMessage } from "../services/api";
import {
  createFamilyMember,
  deleteFamilyMember,
  listFamily,
  updateFamilyMember,
} from "../services/planning.service";
import type { FamilyMember } from "../types/models";
import { formatDate } from "../utils/format";

export default function FamilyPage() {
  const [members, setMembers] = useState<FamilyMember[] | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<FamilyMember | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(() => {
    listFamily().then(setMembers).catch(() => setMembers([]));
  }, []);

  useEffect(load, [load]);

  function openCreate() {
    setEditing(null);
    setName("");
    setError("");
    setFormOpen(true);
  }

  function openEdit(member: FamilyMember) {
    setEditing(member);
    setName(member.name);
    setError("");
    setFormOpen(true);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      if (editing) await updateFamilyMember(editing.id, name);
      else await createFamilyMember(name);
      setFormOpen(false);
      load();
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  }

  async function remove(member: FamilyMember) {
    if (!window.confirm(`למחוק את "${member.name}"? כל הנתונים המשויכים יימחקו!`)) return;
    try {
      await deleteFamilyMember(member.id);
      load();
    } catch (err) {
      window.alert(apiErrorMessage(err));
    }
  }

  if (!members) return <Loading />;

  const columns: Column<FamilyMember>[] = [
    { key: "name", header: "שם", render: (row) => <strong>👤 {row.name}</strong> },
    {
      key: "activity",
      header: "פעילות",
      render: (row) =>
        row._count ? (
          <span className="text-muted">
            {row._count.expenses} הוצאות · {row._count.incomes} הכנסות · {row._count.loans} הלוואות
          </span>
        ) : (
          "—"
        ),
    },
    { key: "since", header: "נוצר", render: (row) => formatDate(row.createdAt) },
    {
      key: "actions",
      header: "",
      align: "left",
      render: (row) => (
        <span className="row-actions">
          <Button size="sm" variant="ghost" onClick={() => openEdit(row)}>✏️</Button>
          <Button size="sm" variant="ghost" onClick={() => remove(row)}>🗑️</Button>
        </span>
      ),
    },
  ];

  return (
    <>
      <div className="page-toolbar">
        <Button onClick={openCreate}>+ בן משפחה</Button>
      </div>

      <Card>
        <Table
          columns={columns}
          rows={members}
          rowKey={(row) => row.id}
          emptyState={<EmptyState icon="👨‍👩‍👧" title="אין בני משפחה" />}
        />
      </Card>

      <Modal title={editing ? "עריכת שם" : "בן משפחה חדש"} open={formOpen} onClose={() => setFormOpen(false)}>
        <form onSubmit={submit}>
          {error && <ErrorMessage message={error} />}
          <Input label="שם" required value={name} onChange={(e) => setName(e.target.value)} />
          <div className="modal-actions">
            <Button type="submit">{editing ? "עדכון" : "הוספה"}</Button>
            <Button type="button" variant="ghost" onClick={() => setFormOpen(false)}>ביטול</Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
