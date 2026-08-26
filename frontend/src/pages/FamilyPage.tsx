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
import { FamilyMemberWizard } from "../components/family/FamilyMemberWizard";
import { useAsync } from "../hooks/useAsync";
import { apiErrorMessage } from "../services/api";
import { toast } from "../services/toast";
import {
  createFamilyMember,
  deleteFamilyMember,
  listFamily,
  updateFamilyMember,
} from "../services/planning.service";
import type { FamilyMember, FamilyRelation } from "../types/models";
import { formatDate } from "../utils/format";

const RELATION_LABELS: Record<FamilyRelation, string> = {
  spouse: "בן/בת זוג",
  child: "ילד/ה",
  parent: "הורה",
  other: "אחר",
};

const RELATION_OPTIONS = (Object.keys(RELATION_LABELS) as FamilyRelation[]).map((value) => ({
  value,
  label: RELATION_LABELS[value],
}));

export default function FamilyPage() {
  const members = useAsync(() => listFamily(), [], "לא הצלחנו לטעון את בני המשפחה");
  const confirm = useConfirm();
  const [wizardOpen, setWizardOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<FamilyMember | null>(null);
  const [name, setName] = useState("");
  const [relation, setRelation] = useState<string>("");
  const [error, setError] = useState("");

  function openCreate() {
    setWizardOpen(true);
  }

  function openEdit(member: FamilyMember) {
    setEditing(member);
    setName(member.name);
    setRelation(member.relation ?? "");
    setError("");
    setFormOpen(true);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      const rel = relation ? (relation as FamilyRelation) : undefined;
      if (editing) await updateFamilyMember(editing.id, name, rel);
      else await createFamilyMember(name, rel);
      setFormOpen(false);
      members.reload();
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  }

  function askRemove(member: FamilyMember) {
    confirm.ask(
      {
        title: `מחיקת ${member.name}`,
        message: (
          <>
            <strong>{member.name}</strong> יימחק מהמערכת.
            <span className="confirm-consequence">
              זהו רק רישום שיוך משפחתי — לא נמחקים נתונים כספיים. הפעולה אינה הפיכה.
            </span>
          </>
        ),
        confirmLabel: "מחיקה",
        tone: "danger",
      },
      async () => {
        await deleteFamilyMember(member.id);
        members.reload();
      }
    );
  }

  const columns: Column<FamilyMember>[] = [
    { key: "name", header: "שם", render: (row) => <strong>👤 {row.name}</strong> },
    {
      key: "relation",
      header: "קשר",
      render: (row) => (
        <span className="text-muted">{row.relation ? RELATION_LABELS[row.relation] : "—"}</span>
      ),
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

  const members_ = members.data ?? [];
  const withRelation = members_.filter((m) => m.relation).length;

  return (
    <PageShell
      toolbar={<Button onClick={openCreate}>+ בן משפחה</Button>}
      summary={
        <AsyncSection
          resource={members}
          errorTitle="לא הצלחנו לטעון את סיכום המשפחה"
          skeleton={<SkeletonKpiRow count={2} label="טוען סיכום" />}
        >
          {(rows) => (
            <div className="kpi-row">
              <SummaryCard label="בני משפחה" value={String(rows.length)} icon="👨‍👩‍👧" />
              <SummaryCard
                label="עם קשר מוגדר"
                value={String(withRelation)}
                icon="🔗"
                sub={withRelation < rows.length ? `${rows.length - withRelation} ללא קשר מוגדר` : undefined}
              />
            </div>
          )}
        </AsyncSection>
      }
    >
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
                <EmptyState icon="👨‍👩‍👧" title="אין בני משפחה" hint="הוסיפי בן משפחה לרישום הבית שלך" />
              }
            />
          )}
        </AsyncSection>
      </Card>

      <Modal title={editing ? "עריכת בן משפחה" : "בן משפחה חדש"} open={formOpen} onClose={() => setFormOpen(false)}>
        <form onSubmit={submit}>
          {error && <ErrorMessage message={error} />}
          <Input label="שם" required value={name} onChange={(e) => setName(e.target.value)} />
          <Select
            label="קשר"
            options={RELATION_OPTIONS}
            placeholder="לא לציין"
            value={relation}
            onChange={(e) => setRelation(e.target.value)}
          />
          <div className="modal-actions">
            <Button type="submit">{editing ? "עדכון" : "הוספה"}</Button>
            <Button type="button" variant="ghost" onClick={() => setFormOpen(false)}>
              ביטול
            </Button>
          </div>
        </form>
      </Modal>

      {wizardOpen && (
        <FamilyMemberWizard
          onCancel={() => setWizardOpen(false)}
          onCreated={(created) => {
            setWizardOpen(false);
            toast.success(`${created} נוסף/ה למשפחה`);
            members.reload();
          }}
        />
      )}

      {confirm.dialog}
    </PageShell>
  );
}
