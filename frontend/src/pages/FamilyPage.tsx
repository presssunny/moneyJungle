import { useState, type FormEvent } from "react";
import { AsyncSection } from "../components/common/AsyncSection";
import { Button } from "../components/common/Button";
import { Card } from "../components/common/Card";
import { useConfirm } from "../components/common/ConfirmDialog";
import { EmptyState } from "../components/common/EmptyState";
import { ErrorMessage } from "../components/common/ErrorMessage";
import { Input } from "../components/common/Input";
import { Modal } from "../components/common/Modal";
import { SkeletonRows } from "../components/common/Skeleton";
import { Table, type Column } from "../components/common/Table";
import { useAsync } from "../hooks/useAsync";
import { apiErrorMessage } from "../services/api";
import {
  createFamilyMember,
  deleteFamilyMember,
  listFamily,
  updateFamilyMember,
} from "../services/planning.service";
import { toast } from "../services/toast";
import type { FamilyMember } from "../types/models";
import { formatDate } from "../utils/format";

/** What a member is linked to — used to say what a deletion would take with it. */
function linkedSummary(member: FamilyMember): string | null {
  if (!member._count) return null;
  const parts: string[] = [];
  if (member._count.expenses) parts.push(`${member._count.expenses} הוצאות`);
  if (member._count.incomes) parts.push(`${member._count.incomes} הכנסות`);
  if (member._count.loans) parts.push(`${member._count.loans} הלוואות`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

export default function FamilyPage() {
  const members = useAsync(() => listFamily(), [], "לא הצלחנו לטעון את בני המשפחה");
  const confirm = useConfirm();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<FamilyMember | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState("");

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
      members.reload();
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  }

  function askRemove(member: FamilyMember) {
    const linked = linkedSummary(member);
    confirm.ask(
      {
        title: `מחיקת ${member.name}`,
        // Say what is actually about to be lost — "are you sure?" alone gives the
        // user nothing to decide with.
        message: (
          <>
            <strong>{member.name}</strong> יימחק מהמערכת.
            <span className="confirm-consequence">
              {linked
                ? `יימחקו יחד איתו גם: ${linked}. הפעולה אינה הפיכה.`
                : "לא משויכים אליו נתונים כספיים. הפעולה אינה הפיכה."}
            </span>
          </>
        ),
        confirmLabel: "מחיקה",
        tone: "danger",
      },
      async () => {
        try {
          await deleteFamilyMember(member.id);
          members.reload();
        } catch (err) {
          toast.error(apiErrorMessage(err));
        }
      }
    );
  }

  const columns: Column<FamilyMember>[] = [
    { key: "name", header: "שם", render: (row) => <strong>👤 {row.name}</strong> },
    {
      key: "activity",
      header: "פעילות",
      render: (row) => <span className="text-muted">{linkedSummary(row) ?? "—"}</span>,
    },
    { key: "since", header: "נוצר", render: (row) => formatDate(row.createdAt) },
    {
      key: "actions",
      header: "",
      align: "left",
      render: (row) => (
        <span className="row-actions">
          <Button size="sm" variant="ghost" onClick={() => openEdit(row)} aria-label={`עריכת ${row.name}`}>
            ✏️
          </Button>
          <Button size="sm" variant="ghost" onClick={() => askRemove(row)} aria-label={`מחיקת ${row.name}`}>
            🗑️
          </Button>
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
        <AsyncSection
          resource={members}
          errorTitle="לא הצלחנו לטעון את בני המשפחה"
          skeleton={<SkeletonRows rows={3} />}
        >
          {(rows) => (
            <Table
              columns={columns}
              rows={rows}
              rowKey={(row) => row.id}
              emptyState={
                <EmptyState
                  icon="👨‍👩‍👧"
                  title="אין בני משפחה"
                  hint="הוסיפי בן משפחה כדי לשייך אליו הכנסות, הוצאות והלוואות"
                />
              }
            />
          )}
        </AsyncSection>
      </Card>

      <Modal title={editing ? "עריכת שם" : "בן משפחה חדש"} open={formOpen} onClose={() => setFormOpen(false)}>
        <form onSubmit={submit}>
          {error && <ErrorMessage message={error} />}
          <Input label="שם" required value={name} onChange={(e) => setName(e.target.value)} />
          <div className="modal-actions">
            <Button type="submit">{editing ? "עדכון" : "הוספה"}</Button>
            <Button type="button" variant="ghost" onClick={() => setFormOpen(false)}>
              ביטול
            </Button>
          </div>
        </form>
      </Modal>

      {confirm.dialog}
    </>
  );
}
