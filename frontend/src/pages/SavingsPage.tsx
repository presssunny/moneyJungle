import { useState, type FormEvent } from "react";
import { AsyncSection } from "../components/common/AsyncSection";
import { Button } from "../components/common/Button";
import { Card } from "../components/common/Card";
import { EmptyState } from "../components/common/EmptyState";
import { ErrorMessage } from "../components/common/ErrorMessage";
import { Input } from "../components/common/Input";
import { Modal } from "../components/common/Modal";
import { SkeletonCard, SkeletonRows } from "../components/common/Skeleton";
import { SummaryCard } from "../components/dashboard/SummaryCard";
import { useAsync } from "../hooks/useAsync";
import { apiErrorMessage } from "../services/api";
import {
  createSavingsGoal,
  deleteSavingsGoal,
  depositToGoal,
  listSavingsGoals,
  updateSavingsGoal,
  type SavingsGoalInput,
} from "../services/planning.service";
import type { SavingsGoal } from "../types/models";
import { formatCurrency, formatDate } from "../utils/format";

const emptyForm: SavingsGoalInput = { goalName: "", targetAmount: 0, currentAmount: 0, monthlyTarget: null, targetDate: null };

/**
 * טאב־משנה "חיסכון" (IA §6.4). Three KPIs, not four — a fourth would be padding.
 * No chart here on purpose: the per-goal progress bars already carry it.
 */
export default function SavingsPage() {
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<SavingsGoal | null>(null);
  const [form, setForm] = useState<SavingsGoalInput>(emptyForm);
  const [error, setError] = useState("");
  const [depositGoal, setDepositGoal] = useState<SavingsGoal | null>(null);
  const [depositAmount, setDepositAmount] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  const goalsRes = useAsync(() => listSavingsGoals(), [reloadKey], "לא הצלחנו לטעון את יעדי החיסכון");
  const load = () => setReloadKey((k) => k + 1);
  const goals = goalsRes.data ?? [];

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setError("");
    setFormOpen(true);
  }

  function openEdit(goal: SavingsGoal) {
    setEditing(goal);
    setForm({
      goalName: goal.goalName,
      targetAmount: Number(goal.targetAmount),
      currentAmount: Number(goal.currentAmount),
      monthlyTarget: goal.monthlyTarget !== null ? Number(goal.monthlyTarget) : null,
      targetDate: goal.targetDate?.slice(0, 10) ?? null,
    });
    setError("");
    setFormOpen(true);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      const payload = { ...form, targetDate: form.targetDate || null, monthlyTarget: form.monthlyTarget || null };
      if (editing) await updateSavingsGoal(editing.id, payload);
      else await createSavingsGoal(payload);
      setFormOpen(false);
      load();
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  }

  async function submitDeposit(e: FormEvent) {
    e.preventDefault();
    if (!depositGoal) return;
    await depositToGoal(depositGoal.id, Number(depositAmount));
    setDepositGoal(null);
    setDepositAmount("");
    load();
  }

  async function remove(goal: SavingsGoal) {
    if (!window.confirm(`למחוק את היעד "${goal.goalName}"?`)) return;
    await deleteSavingsGoal(goal.id);
    load();
  }

  const totalSaved = goals.reduce((sum, g) => sum + Number(g.currentAmount), 0);
  const totalTarget = goals.reduce((sum, g) => sum + Number(g.targetAmount), 0);
  const completion = totalTarget > 0 ? (totalSaved / totalTarget) * 100 : null;

  return (
    <>
      <div className="page-toolbar">
        <Button onClick={openCreate}>+ יעד חיסכון</Button>
      </div>

      {/* KPI (§6.4) */}
      <div className="kpi-row">
        <AsyncSection
          resource={goalsRes}
          errorTitle="לא הצלחנו לטעון את יעדי החיסכון"
          skeleton={<SkeletonCard />}
          isEmpty={(data) => data.length === 0}
          emptyState={
            <SummaryCard label="חיסכון" value="—" certainty="unknown" sub="אין עדיין יעדי חיסכון" />
          }
        >
          {() => (
            <>
              <SummaryCard label="סה״כ נחסך" value={formatCurrency(totalSaved)} tone="success" />
              <SummaryCard label="יעד כולל" value={formatCurrency(totalTarget)} />
              <SummaryCard
                label="אחוז השלמה"
                value={completion === null ? "—" : `${Math.round(completion)}%`}
                // Goals with no target amount cannot produce a percentage (§1.2).
                certainty={completion === null ? "unknown" : "measured"}
                tone={completion !== null && completion >= 100 ? "success" : "primary"}
                sub={`${goals.length} יעדים`}
              />
            </>
          )}
        </AsyncSection>
      </div>

      <AsyncSection
        resource={goalsRes}
        errorTitle="לא הצלחנו לטעון את יעדי החיסכון"
        skeleton={<SkeletonRows rows={3} />}
        isEmpty={(data) => data.length === 0}
        emptyState={
          <Card>
            <EmptyState
              icon="🐷"
              title="אין עדיין יעדי חיסכון"
              hint="הגדירי יעד — אפילו קטן — כדי לראות התקדמות"
              action={
                <Button size="sm" onClick={openCreate}>
                  + יעד חיסכון
                </Button>
              }
            />
          </Card>
        }
      >
        {(goalList) => (
        <div className="budget-grid">
          {goalList.map((goal) => {
            const current = Number(goal.currentAmount);
            const target = Number(goal.targetAmount);
            const percent = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;
            return (
              <Card key={goal.id} className="budget-card">
                <div className="budget-card-head">
                  <span className="budget-card-name">🐷 {goal.goalName}</span>
                  <span className="row-actions">
                    <Button size="sm" variant="ghost" onClick={() => openEdit(goal)} aria-label="עריכה">✏️</Button>
                    <Button size="sm" variant="ghost" onClick={() => remove(goal)} aria-label="מחיקה">🗑️</Button>
                  </span>
                </div>
                <div className="budget-bar">
                  <div className="budget-bar-fill tone-success-bg" style={{ width: `${percent}%` }} />
                </div>
                <div className="budget-card-meta">
                  <span className="mono text-success">{formatCurrency(current)}</span>
                  <span className="text-muted"> / {formatCurrency(target)}</span>
                  <span className="budget-percent text-success">{percent}%</span>
                </div>
                <div className="budget-card-remaining">
                  {goal.monthlyTarget !== null && <span className="text-muted">יעד חודשי {formatCurrency(Number(goal.monthlyTarget))} · </span>}
                  {goal.targetDate && <span className="text-muted">עד {formatDate(goal.targetDate)}</span>}
                </div>
                <Button size="sm" variant="outline" onClick={() => setDepositGoal(goal)}>+ הפקדה</Button>
              </Card>
            );
          })}
        </div>
        )}
      </AsyncSection>

      <Modal title={editing ? "עריכת יעד" : "יעד חיסכון חדש"} open={formOpen} onClose={() => setFormOpen(false)}>
        <form onSubmit={submit}>
          {error && <ErrorMessage message={error} />}
          <Input label="שם היעד" required value={form.goalName} onChange={(e) => setForm({ ...form, goalName: e.target.value })} />
          <div className="form-row">
            <Input
              label="סכום יעד (₪)"
              type="number"
              step="1"
              min="1"
              required
              value={form.targetAmount || ""}
              onChange={(e) => setForm({ ...form, targetAmount: Number(e.target.value) })}
            />
            <Input
              label="נחסך עד היום (₪)"
              type="number"
              step="0.01"
              min="0"
              value={form.currentAmount ?? ""}
              onChange={(e) => setForm({ ...form, currentAmount: Number(e.target.value) })}
            />
          </div>
          <div className="form-row">
            <Input
              label="יעד חודשי (₪, רשות)"
              type="number"
              step="1"
              min="0"
              value={form.monthlyTarget ?? ""}
              onChange={(e) => setForm({ ...form, monthlyTarget: e.target.value ? Number(e.target.value) : null })}
            />
            <Input
              label="תאריך יעד (רשות)"
              type="date"
              value={form.targetDate ?? ""}
              onChange={(e) => setForm({ ...form, targetDate: e.target.value || null })}
            />
          </div>
          <div className="modal-actions">
            <Button type="submit">{editing ? "עדכון" : "הוספה"}</Button>
            <Button type="button" variant="ghost" onClick={() => setFormOpen(false)}>ביטול</Button>
          </div>
        </form>
      </Modal>

      <Modal title={depositGoal ? `הפקדה — ${depositGoal.goalName}` : ""} open={depositGoal !== null} onClose={() => setDepositGoal(null)}>
        <form onSubmit={submitDeposit}>
          <Input
            label="סכום (₪, שלילי למשיכה)"
            type="number"
            step="0.01"
            required
            value={depositAmount}
            onChange={(e) => setDepositAmount(e.target.value)}
          />
          <div className="modal-actions">
            <Button type="submit">הפקדה</Button>
            <Button type="button" variant="ghost" onClick={() => setDepositGoal(null)}>ביטול</Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
