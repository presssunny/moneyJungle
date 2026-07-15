import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Button } from "../components/common/Button";
import { Card } from "../components/common/Card";
import { EmptyState } from "../components/common/EmptyState";
import { ErrorMessage } from "../components/common/ErrorMessage";
import { Input } from "../components/common/Input";
import { Loading } from "../components/common/Loading";
import { Modal } from "../components/common/Modal";
import { Select } from "../components/common/Select";
import { useMonth } from "../context/MonthContext";
import { useLookups } from "../hooks/useLookups";
import { apiErrorMessage } from "../services/api";
import { copyBudgets, deleteBudget, listBudgets, upsertBudget } from "../services/finance.service";
import type { BudgetsResponse } from "../types/models";
import { formatCurrency } from "../utils/format";

export default function BudgetsPage() {
  const { monthKey } = useMonth();
  const { expenseCategories } = useLookups();
  const [data, setData] = useState<BudgetsResponse | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [categoryId, setCategoryId] = useState<number | "">("");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(() => {
    listBudgets(monthKey).then(setData).catch(() => setData({ budgets: [], totals: { total: 0, used: 0, usedPercent: 0, remaining: 0 } }));
  }, [monthKey]);

  useEffect(load, [load]);

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

  if (!data) return <Loading />;

  const { budgets, totals } = data;
  const usedCategoryIds = new Set(budgets.map((b) => b.categoryId));
  const availableCategories = expenseCategories.filter((c) => !usedCategoryIds.has(c.id));

  return (
    <>
      <div className="page-toolbar">
        <Button onClick={() => setFormOpen(true)}>+ הגדרת תקציב</Button>
        <Button variant="outline" onClick={copyFromPrevious}>העתקה מחודש קודם ⧉</Button>
        <div className="toolbar-total">
          נוצל <strong className="mono">{formatCurrency(totals.used)}</strong> מתוך{" "}
          <strong className="mono">{formatCurrency(totals.total)}</strong>
          {totals.total > 0 && <span className={totals.usedPercent > 100 ? "text-danger" : "text-muted"}> ({Math.round(totals.usedPercent)}%)</span>}
        </div>
      </div>

      {message && <div className="info-banner">{message}</div>}

      {budgets.length === 0 ? (
        <Card>
          <EmptyState icon="🎯" title="אין תקציבים לחודש הזה" hint="הגדירי תקציב לקטגוריה או העתיקי מהחודש הקודם" />
        </Card>
      ) : (
        <div className="budget-grid">
          {budgets.map((budget) => {
            const percent = Math.min(150, budget.usedPercent);
            const tone = budget.usedPercent > 100 ? "danger" : budget.usedPercent >= 85 ? "warning" : "success";
            return (
              <Card key={budget.id} className="budget-card">
                <div className="budget-card-head">
                  <span className="budget-card-name">
                    {budget.category.icon} {budget.category.name}
                  </span>
                  <Button size="sm" variant="ghost" onClick={() => remove(budget.id, budget.category.name)}>🗑️</Button>
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
                    <span className="text-danger">חריגה של {formatCurrency(-budget.remaining)}</span>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

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
