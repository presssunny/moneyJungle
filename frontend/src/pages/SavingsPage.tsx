import { MetricExplanation } from "../components/common/MetricExplanation";
import { useState, type FormEvent } from "react";
import { AsyncSection } from "../components/common/AsyncSection";
import { PageShell } from "../components/common/PageShell";
import { ActionMenu } from "../components/common/ActionMenu";
import { Button } from "../components/common/Button";
import { Card } from "../components/common/Card";
import { useConfirm } from "../components/common/ConfirmDialog";
import { EmptyState } from "../components/common/EmptyState";
import { ErrorMessage } from "../components/common/ErrorMessage";
import { Input } from "../components/common/Input";
import { Modal } from "../components/common/Modal";
import { Select } from "../components/common/Select";
import { SkeletonCard, SkeletonRows } from "../components/common/Skeleton";
import { SummaryCard } from "../components/dashboard/SummaryCard";
import { useAsync } from "../hooks/useAsync";
import { apiErrorMessage } from "../services/api";
import { listLoans } from "../services/finance.service";
import {
  createSavingsGoal,
  deleteSavingsGoal,
  depositToGoal,
  listSavingsGoals,
  updateSavingsGoal,
  type SavingsGoalInput,
} from "../services/planning.service";
import type { GoalType, SavingsGoal } from "../types/models";
import { formatCurrency, formatDate } from "../utils/format";

const emptyForm: SavingsGoalInput = { goalName: "", goalType: "savings", targetAmount: 0, currentAmount: 0, monthlyTarget: null, targetDate: null };

const GOAL_TYPES: Array<{ value: GoalType; label: string; icon: string }> = [
  { value: "savings", label: "חיסכון", icon: "🐷" },
  { value: "purchase", label: "רכישה גדולה", icon: "🛒" },
  { value: "debt_payoff", label: "סילוק הלוואה", icon: "📉" },
];
const iconOf = (type: GoalType) => GOAL_TYPES.find((t) => t.value === type)?.icon ?? "🎯";

/**
 * טאב־משנה "חיסכון" (IA §6.4). Three KPIs, not four — a fourth would be padding.
 * No chart here on purpose: the per-goal progress bars already carry it.
 */
export default function SavingsPage() {
  const confirm = useConfirm();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<SavingsGoal | null>(null);
  const [form, setForm] = useState<SavingsGoalInput>(emptyForm);
  const [error, setError] = useState("");
  const [depositGoal, setDepositGoal] = useState<SavingsGoal | null>(null);
  const [depositAmount, setDepositAmount] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  const goalsRes = useAsync(() => listSavingsGoals(), [reloadKey], "לא הצלחנו לטעון את היעדים");
  const loansRes = useAsync(() => listLoans(), [], "לא הצלחנו לטעון את ההלוואות", ["loans"]);
  const openLoans = (loansRes.data?.loans ?? []).filter((loan) => loan.status !== "finished" && loan.currentBalance > 0);
  const load = () => setReloadKey((k) => k + 1);

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
      goalType: goal.goalType,
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
      const shared = { goalName: form.goalName, targetDate: form.targetDate || null, monthlyTarget: form.monthlyTarget || null };
      const debt = form.goalType === "debt_payoff";
      // A payoff goal's amounts come from the loan on the server; sending them would be refused.
      if (editing) await updateSavingsGoal(editing.id, debt ? shared : { ...shared, targetAmount: form.targetAmount, currentAmount: form.currentAmount });
      else await createSavingsGoal(debt ? { ...shared, goalType: "debt_payoff", loanId: form.loanId } : { ...shared, goalType: form.goalType, targetAmount: form.targetAmount, currentAmount: form.currentAmount });
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

  function remove(goal: SavingsGoal) {
    confirm.ask(
      {
        title: "מחיקת יעד",
        message: (
          <>
            היעד <strong>{goal.goalName}</strong> יימחק.
            <span className="confirm-consequence">
              {goal.goalType === "debt_payoff"
                ? "ההלוואה עצמה לא משתנה; רק המעקב אחרי הסילוק יימחק."
                : "ההתקדמות שנרשמה ביעד תימחק גם היא. כסף בחשבונות לא זז."}
            </span>
          </>
        ),
        confirmLabel: "מחיקה",
        tone: "danger",
      },
      async () => {
        await deleteSavingsGoal(goal.id);
        load();
      }
    );
  }

  return (
    <PageShell
      toolbar={
        <>
          <Button onClick={openCreate}>+ יעד</Button>
        </>
      }
    >

      {/* KPI (§6.4) */}
      <div className="kpi-row">
        <AsyncSection
          resource={goalsRes}
          errorTitle="לא הצלחנו לטעון את יעדי החיסכון"
          skeleton={<SkeletonCard />}
          isEmpty={(data) => data.goals.length === 0}
          emptyState={
            <SummaryCard label="חיסכון" value="—" certainty="unknown" sub="אין עדיין יעדים" />
          }
        >
          {({ summary, goals }) => (
            <>
              <MetricExplanation title="איך נמדדת ההתקדמות?"><p>ביעדי חיסכון ורכישה: ההתקדמות שנרשמה ידנית, חלקי סכום היעדים. זו אינה יתרת נכס מאומתת; הכסף עשוי כבר להיות כלול בחשבון הבנק. יעד סילוק הלוואה אינו חיסכון ולכן אינו נספר כאן — ההתקדמות בו נקראת מיתרת ההלוואה הרשומה, שמתעדכנת בייבוא לוח סילוקין, בעריכה או בסגירת ההלוואה, ולא בכל חיוב חודשי.</p></MetricExplanation>
              <SummaryCard label="התקדמות רשומה" value={formatCurrency(summary.savedTotal)} tone="success" />
              <SummaryCard label="יעד כולל" value={formatCurrency(summary.targetTotal)} />
              <SummaryCard
                label="אחוז השלמה"
                value={summary.completion === null ? "—" : `${summary.completion}%`}
                certainty={summary.completion === null ? "unknown" : "measured"}
                tone={summary.completion !== null && summary.completion >= 100 ? "success" : "primary"}
                sub={`${summary.setAsideCount} יעדי חיסכון · ${goals.length - summary.setAsideCount} יעדי סילוק`}
              />
            </>
          )}
        </AsyncSection>
      </div>

      <AsyncSection
        resource={goalsRes}
        errorTitle="לא הצלחנו לטעון את יעדי החיסכון"
        skeleton={<SkeletonRows rows={3} />}
        isEmpty={(data) => data.goals.length === 0}
        emptyState={
          <Card>
            <EmptyState
              icon="🐷"
              title="אין עדיין יעדים"
              hint="חיסכון, רכישה גדולה או סילוק הלוואה — אפילו יעד קטן מראה התקדמות"
              action={
                <Button size="sm" onClick={openCreate}>
                  + יעד
                </Button>
              }
            />
          </Card>
        }
      >
        {({ goals }) => (
        <div className="budget-grid">
          {goals.map((goal) => {
            const { current, target, percent, remaining, source } = goal.progress;
            const debt = goal.goalType === "debt_payoff";
            return (
              <Card key={goal.id} className="budget-card">
                <div className="budget-card-head">
                  <span className="budget-card-name">{iconOf(goal.goalType)} {goal.goalName}</span>
                  <ActionMenu
                    label={`פעולות ליעד ${goal.goalName}`}
                    items={[
                      { label: "עריכה", onSelect: () => openEdit(goal) },
                      { label: "מחיקה", tone: "danger", onSelect: () => remove(goal) },
                    ]}
                  />
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
                  {debt && source === "loan" && <span className="text-muted">נותרו {formatCurrency(remaining)} לפי יתרת {goal.loan?.loanName}, נכון ל־{formatDate(goal.progress.asOf)} · </span>}
                  {source === "unavailable" && <span className="text-warning">ההלוואה המקושרת נמחקה — אין ממה למדוד התקדמות · </span>}
                  {goal.monthlyTarget !== null && <span className="text-muted">יעד חודשי {formatCurrency(Number(goal.monthlyTarget))} · </span>}
                  {goal.targetDate && <span className="text-muted">עד {formatDate(goal.targetDate)}</span>}
                </div>
                {!debt && <Button size="sm" variant="outline" onClick={() => setDepositGoal(goal)}>+ הפקדה</Button>}
              </Card>
            );
          })}
        </div>
        )}
      </AsyncSection>

      <Modal title={editing ? "עריכת יעד" : "יעד חדש"} open={formOpen} onClose={() => setFormOpen(false)}>
        <form onSubmit={submit}>
          {error && <ErrorMessage message={error} />}
          <Input label="שם היעד" required value={form.goalName} onChange={(e) => setForm({ ...form, goalName: e.target.value })} />
          {!editing && (
            <Select
              label="סוג היעד"
              options={GOAL_TYPES.map(({ value, label }) => ({ value, label }))}
              value={form.goalType}
              onChange={(e) => setForm({ ...form, goalType: e.target.value as GoalType })}
            />
          )}
          {form.goalType === "debt_payoff" ? (
            !editing && (
              <Select
                label="הלוואה לסילוק"
                required
                placeholder={openLoans.length ? "בחירת הלוואה" : "אין הלוואות פתוחות"}
                options={openLoans.map((loan) => ({ value: String(loan.id), label: `${loan.loanName} — ${formatCurrency(loan.currentBalance)}` }))}
                value={form.loanId ? String(form.loanId) : ""}
                onChange={(e) => setForm({ ...form, loanId: e.target.value ? Number(e.target.value) : undefined })}
              />
            )
          ) : (
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
          )}
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

      {confirm.dialog}
    </PageShell>
  );
}
