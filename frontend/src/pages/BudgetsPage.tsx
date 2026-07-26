import { useMemo, useState, type FormEvent } from "react";
import { AsyncSection } from "../components/common/AsyncSection";
import { Button } from "../components/common/Button";
import { Card } from "../components/common/Card";
import { EmptyState } from "../components/common/EmptyState";
import { ErrorMessage } from "../components/common/ErrorMessage";
import { Input } from "../components/common/Input";
import { Modal } from "../components/common/Modal";
import { Select } from "../components/common/Select";
import { SkeletonCard, SkeletonChart, SkeletonRows } from "../components/common/Skeleton";
import { Table, type Column } from "../components/common/Table";
import { UNKNOWN_PLACEHOLDER } from "../components/common/UncertaintyBadge";
import { BudgetVsActualChart } from "../components/dashboard/BudgetVsActualChart";
import { MonthProgressPanel } from "../components/dashboard/MonthProgressPanel";
import { SummaryCard } from "../components/dashboard/SummaryCard";
import { useMonth } from "../context/MonthContext";
import { useAsync } from "../hooks/useAsync";
import { useLookups } from "../hooks/useLookups";
import { apiErrorMessage } from "../services/api";
import { copyBudgets, deleteBudget, listBudgets, listExpenses, upsertBudget } from "../services/finance.service";
import { updateSettings } from "../services/planning.service";
import type { BudgetItem } from "../types/models";
import { formatCurrency } from "../utils/format";

/**
 * טאב "תקציב" (IA §5): "what did I plan vs what happened, and where am I over?".
 *
 * `MonthProgressPanel` moved here from the expenses page — "am I on pace against
 * a plan" is a budget question, not a bookkeeping one (§5.2).
 */
export default function BudgetsPage() {
  const { monthKey } = useMonth();
  const { expenseCategories } = useLookups();
  const [formOpen, setFormOpen] = useState(false);
  const [categoryId, setCategoryId] = useState<number | "">("");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [view, setView] = useState<"cards" | "table">("cards");
  const [onlyOverrun, setOnlyOverrun] = useState(false);

  const budgetsRes = useAsync(
    () => listBudgets(monthKey),
    [monthKey, reloadKey],
    "לא הצלחנו לטעון את נתוני התקציב"
  );
  // Only the month-pace panel needs this; a failure here must not hide budgets.
  const progressRes = useAsync(
    () => listExpenses(monthKey),
    [monthKey, reloadKey],
    "לא הצלחנו לטעון את קצב החודש"
  );

  const load = () => setReloadKey((k) => k + 1);

  const budgets = useMemo(() => budgetsRes.data?.budgets ?? [], [budgetsRes.data]);
  const overrunCount = budgets.filter((b) => b.usedPercent > 100).length;
  const visibleBudgets = onlyOverrun ? budgets.filter((b) => b.usedPercent > 100) : budgets;

  async function saveTarget(value: number | null) {
    await updateSettings({ monthlyTarget: value });
    load();
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!categoryId) return;
    setError("");
    try {
      await upsertBudget(monthKey, Number(categoryId), Number(amount));
      setFormOpen(false);
      setCategoryId("");
      setAmount("");
      load();
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  }

  async function copyFromPrevious() {
    setMessage("");
    try {
      const result = await copyBudgets(monthKey);
      setMessage(`הועתקו ${result.copied ?? 0} תקציבים מהחודש הקודם`);
      load();
    } catch (err) {
      setMessage(apiErrorMessage(err));
    }
  }

  async function remove(id: number, name: string) {
    if (!window.confirm(`למחוק את התקציב של "${name}"?`)) return;
    await deleteBudget(id);
    load();
  }

  const usedCategoryIds = new Set(budgets.map((b) => b.categoryId));
  const availableCategories = expenseCategories.filter((c) => !usedCategoryIds.has(c.id));

  const columns: Column<BudgetItem>[] = [
    {
      key: "category",
      header: "קטגוריה",
      render: (row) => (
        <span>
          {row.category.icon} {row.category.name}
        </span>
      ),
    },
    { key: "amount", header: "תקציב", align: "left", render: (row) => <span className="mono">{formatCurrency(row.amount)}</span> },
    { key: "spent", header: "בפועל", align: "left", render: (row) => <span className="mono">{formatCurrency(row.spent)}</span> },
    {
      key: "remaining",
      header: "נותר",
      align: "left",
      render: (row) => (
        <span className={`mono ${row.remaining < 0 ? "text-danger" : ""}`}>{formatCurrency(row.remaining)}</span>
      ),
    },
    {
      key: "percent",
      header: "ניצול",
      align: "left",
      render: (row) => {
        const tone = row.usedPercent > 100 ? "danger" : row.usedPercent >= 85 ? "warning" : "success";
        return (
          <span className={`mono text-${tone}`}>
            {row.usedPercent > 100 && <span aria-hidden>⚠ </span>}
            {Math.round(row.usedPercent)}%
          </span>
        );
      },
    },
    {
      key: "trend",
      header: "מגמה מול חודש קודם",
      align: "left",
      // GET /budgets has no previous-month spend (IA §9.5). Showing a dash is the
      // honest answer; a guessed number would violate §1.2.
      render: () => <span className="text-muted" title="אין עדיין נתוני חודש קודם ב-API">{UNKNOWN_PLACEHOLDER}</span>,
    },
    {
      key: "actions",
      header: "",
      align: "left",
      render: (row) => (
        <span className="row-actions">
          <Button size="sm" variant="ghost" onClick={() => remove(row.id, row.category.name)} aria-label="מחיקה">
            🗑️
          </Button>
        </span>
      ),
    },
  ];

  const emptyBudgets = (
    <EmptyState
      icon="🎯"
      title="אין תקציבים לחודש הזה"
      hint="הגדירי תקציב לקטגוריה, או העתיקי מהחודש הקודם"
      action={
        <div className="row-actions">
          <Button size="sm" onClick={() => setFormOpen(true)}>
            + הגדרת תקציב
          </Button>
          <Button size="sm" variant="outline" onClick={copyFromPrevious}>
            העתקה מחודש קודם ⧉
          </Button>
        </div>
      }
    />
  );

  return (
    <>
      <div className="page-toolbar">
        <Button onClick={() => setFormOpen(true)}>+ הגדרת תקציב</Button>
        <Button variant="outline" onClick={copyFromPrevious}>העתקה מחודש קודם ⧉</Button>
      </div>

      {message && <div className="info-banner">{message}</div>}

      {/* KPI (§5.1) */}
      <div className="kpi-row">
        <AsyncSection
          resource={budgetsRes}
          errorTitle="לא הצלחנו לטעון את נתוני התקציב"
          skeleton={<SkeletonCard />}
          isEmpty={(data) => data.budgets.length === 0}
          emptyState={<SummaryCard label="תקציב החודש" value="—" certainty="unknown" sub="עוד לא הגדרת תקציב לחודש הזה" />}
        >
          {(data) => (
            <>
              <SummaryCard label="תקציב כולל" value={formatCurrency(data.totals.total)} />
              <SummaryCard
                label="נוצל"
                value={formatCurrency(data.totals.used)}
                sub={`${Math.round(data.totals.usedPercent)}% מהתקציב`}
                tone={
                  data.totals.usedPercent > 100 ? "danger" : data.totals.usedPercent >= 85 ? "warning" : "success"
                }
              />
              <SummaryCard
                label="נותר"
                value={formatCurrency(data.totals.remaining)}
                tone={data.totals.remaining < 0 ? "danger" : "primary"}
              />
              <SummaryCard
                label="קטגוריות בחריגה"
                value={`${overrunCount} מתוך ${data.budgets.length}`}
                tone={overrunCount > 0 ? "danger" : "success"}
                sub={overrunCount > 0 ? "לחיצה מציגה רק אותן" : "אין חריגות ✓"}
                onClick={overrunCount > 0 ? () => setOnlyOverrun(true) : undefined}
              />
            </>
          )}
        </AsyncSection>
      </div>

      <AsyncSection
        resource={progressRes}
        errorTitle="לא הצלחנו לטעון את קצב החודש"
        skeleton={<SkeletonChart height={150} label="טוען את קצב החודש" />}
        isEmpty={(data) => data.progress.target === null && !data.progress.isCurrentMonth}
        emptyState={null}
      >
        {(data) => <MonthProgressPanel progress={data.progress} onSaveTarget={saveTarget} />}
      </AsyncSection>

      <Card title="מתוכנן מול בפועל">
        <AsyncSection
          resource={budgetsRes}
          errorTitle="לא הצלחנו לטעון את ההשוואה"
          skeleton={<SkeletonChart />}
          isEmpty={(data) => data.budgets.length === 0}
          emptyState={<EmptyState icon="📊" title="אין תקציבים להשוואה" hint="הגדירי תקציב לקטגוריה כדי לראות פער" />}
        >
          {(data) => <BudgetVsActualChart budgets={data.budgets} />}
        </AsyncSection>
      </Card>

      <Card
        title="תקציבים לפי קטגוריה"
        action={
          <span className="row-actions">
            <label className="filter-toggle">
              <input type="checkbox" checked={onlyOverrun} onChange={(e) => setOnlyOverrun(e.target.checked)} />
              רק חריגות
            </label>
            <Button size="sm" variant={view === "cards" ? "primary" : "ghost"} onClick={() => setView("cards")}>
              כרטיסים
            </Button>
            <Button size="sm" variant={view === "table" ? "primary" : "ghost"} onClick={() => setView("table")}>
              טבלה
            </Button>
          </span>
        }
      >
        <AsyncSection
          resource={budgetsRes}
          errorTitle="לא הצלחנו לטעון את התקציבים"
          skeleton={<SkeletonRows rows={4} />}
          isEmpty={(data) => data.budgets.length === 0}
          emptyState={emptyBudgets}
        >
          {() =>
            visibleBudgets.length === 0 ? (
              <EmptyState
                icon="🔍"
                title="אין תוצאות למסננים הנוכחיים"
                action={
                  <Button size="sm" variant="outline" onClick={() => setOnlyOverrun(false)}>
                    ניקוי מסננים
                  </Button>
                }
              />
            ) : view === "table" ? (
              <Table columns={columns} rows={visibleBudgets} rowKey={(row) => row.id} pageSize={20} />
            ) : (
              <div className="budget-grid">
                {visibleBudgets.map((budget) => {
                  const percent = Math.min(150, budget.usedPercent);
                  const tone = budget.usedPercent > 100 ? "danger" : budget.usedPercent >= 85 ? "warning" : "success";
                  return (
                    <Card key={budget.id} className="budget-card">
                      <div className="budget-card-head">
                        <span className="budget-card-name">
                          {budget.category.icon} {budget.category.name}
                        </span>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => remove(budget.id, budget.category.name)}
                          aria-label="מחיקה"
                        >
                          🗑️
                        </Button>
                      </div>
                      <div className="budget-bar">
                        <div
                          className={`budget-bar-fill tone-${tone}-bg`}
                          style={{ width: `${Math.min(100, percent)}%` }}
                        />
                      </div>
                      <div className="budget-card-meta">
                        <span className="mono">{formatCurrency(budget.spent)}</span>
                        <span className="text-muted"> / {formatCurrency(budget.amount)}</span>
                        <span className={`budget-percent text-${tone}`}>{Math.round(budget.usedPercent)}%</span>
                      </div>
                      <div className="budget-card-remaining">
                        {budget.remaining >= 0 ? (
                          <span className="text-muted">נשארו {formatCurrency(budget.remaining)}</span>
                        ) : (
                          <span className="text-danger">⚠ חריגה של {formatCurrency(-budget.remaining)}</span>
                        )}
                      </div>
                    </Card>
                  );
                })}
              </div>
            )
          }
        </AsyncSection>
      </Card>

      <Modal title="הגדרת תקציב חודשי" open={formOpen} onClose={() => setFormOpen(false)}>
        <form onSubmit={submit}>
          {error && <ErrorMessage message={error} />}
          <Select
            label="קטגוריה"
            options={[...availableCategories, ...expenseCategories.filter((c) => usedCategoryIds.has(c.id))].map((c) => ({
              value: c.id,
              label: `${c.icon ?? ""} ${c.name}${usedCategoryIds.has(c.id) ? " (עדכון)" : ""}`,
            }))}
            placeholder="בחרי קטגוריה"
            required
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value ? Number(e.target.value) : "")}
          />
          <Input
            label="סכום חודשי (₪)"
            type="number"
            step="1"
            min="1"
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <div className="modal-actions">
            <Button type="submit">שמירה</Button>
            <Button type="button" variant="ghost" onClick={() => setFormOpen(false)}>ביטול</Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
