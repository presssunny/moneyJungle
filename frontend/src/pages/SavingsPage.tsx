import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Button } from "../components/common/Button";
import { Card } from "../components/common/Card";
import { EmptyState } from "../components/common/EmptyState";
import { ErrorMessage } from "../components/common/ErrorMessage";
import { Input } from "../components/common/Input";
import { Loading } from "../components/common/Loading";
import { Modal } from "../components/common/Modal";
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

export default function SavingsPage() {
  const [goals, setGoals] = useState<SavingsGoal[] | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<SavingsGoal | null>(null);
  const [form, setForm] = useState<SavingsGoalInput>(emptyForm);
  const [error, setError] = useState("");
  const [depositGoal, setDepositGoal] = useState<SavingsGoal | null>(null);
  const [depositAmount, setDepositAmount] = useState("");

  const load = useCallback(() => {
    listSavingsGoals().then(setGoals).catch(() => setGoals([]));
  }, []);

  useEffect(load, [load]);

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

  if (!goals) return <Loading />;

  const totalSaved = goals.reduce((sum, g) => sum + Number(g.currentAmount), 0);

  return (
    <>
      <div className="page-toolbar">
        <Button onClick={openCreate}>+ יעד חיסכון</Button>
        {goals.length > 0 && (
          <div className="toolbar-total">
            נחסך סה״כ: <strong className="mono text-success">{formatCurrency(totalSaved)}</strong>
          </div>
        )}
      </div>

      {goals.length === 0 ? (
        <Card>
          <EmptyState icon="🐷" title="אין יעדי חיסכון" hint="חופשה, רכב חדש, קרן חירום — הגדירי יעד ותתחילי לחסוך" />
        </Card>
      ) : (
        <div className="budget-grid">
          {goals.map((goal) => {
            const current = Number(goal.currentAmount);
            const target = Number(goal.targetAmount);
            const percent = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;
            return (
              <Card key={goal.id} className="budget-card">
                <div className="budget-card-head">
                  <span className="budget-card-name">🐷 {goal.goalName}</span>
                  <span className="row-actions">
                    <Button size="sm" variant="ghost" onClick={() => openEdit(goal)}>✏️</Button>
                    <Button size="sm" variant="ghost" onClick={() => remove(goal)}>🗑️</Button>
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
