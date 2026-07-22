import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useLocation } from "react-router-dom";
import { Button } from "../components/common/Button";
import { Card } from "../components/common/Card";
import { CategoryBarChart } from "../components/dashboard/CategoryBarChart";
import { MonthProgressPanel } from "../components/dashboard/MonthProgressPanel";
import { SummaryCard } from "../components/dashboard/SummaryCard";
import { updateSettings } from "../services/planning.service";
import type { CategorySlice } from "../types/dashboard.types";
import { EmptyState } from "../components/common/EmptyState";
import { ErrorMessage } from "../components/common/ErrorMessage";
import { Input } from "../components/common/Input";
import { Loading } from "../components/common/Loading";
import { Modal } from "../components/common/Modal";
import { Select } from "../components/common/Select";
import { Table, type Column } from "../components/common/Table";
import { useMonth } from "../context/MonthContext";
import { useLookups } from "../hooks/useLookups";
import { apiErrorMessage } from "../services/api";
import {
  createExpense,
  deleteExpense,
  importExpensesFile,
  listExpenses,
  updateExpense,
  type ExpenseInput,
  type MonthProgress,
} from "../services/finance.service";
import type { Expense } from "../types/models";
import { formatCurrency, formatDate } from "../utils/format";

const emptyForm = (monthKey: string): ExpenseInput => ({
  amount: 0,
  expenseDate: `${monthKey}-01`,
  categoryId: null,
  paymentMethodId: null,
  businessName: "",
  description: "",
});

export default function ExpensesPage() {
  const { monthKey } = useMonth();
  const location = useLocation();
  const { expenseCategories, paymentMethods } = useLookups();
  const [expenses, setExpenses] = useState<Expense[] | null>(null);
  const [total, setTotal] = useState(0);
  const [progress, setProgress] = useState<MonthProgress | null>(null);
  const [filterCategory, setFilterCategory] = useState<number | undefined>();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [form, setForm] = useState<ExpenseInput>(emptyForm(monthKey));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [importMessage, setImportMessage] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    listExpenses(monthKey, filterCategory)
      .then((data) => {
        setExpenses(data.expenses);
        setTotal(data.total);
        setProgress(data.progress);
      })
      .catch(() => setExpenses([]));
  }, [monthKey, filterCategory]);

  async function saveTarget(value: number | null) {
    await updateSettings({ monthlyTarget: value });
    load();
  }

  useEffect(load, [load]);

  // The dashboard's "הוספת הוצאה" button lands here with openForm state
  useEffect(() => {
    if ((location.state as { openForm?: boolean } | null)?.openForm) {
      setForm(emptyForm(monthKey));
      setFormOpen(true);
      window.history.replaceState({}, "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const UNCATEGORIZED_COLOR = "#6D6875";

  // Mini-dashboard, computed from the already-loaded rows (credit + manual) —
  // no extra request, always consistent with the table and the category filter.
  const stats = useMemo(() => {
    const rows = expenses ?? [];
    const count = rows.length;
    let largest = 0;
    let creditTotal = 0;
    const byCat = new Map<string, CategorySlice>();
    for (const r of rows) {
      const value = Number(r.amount);
      if (value > largest) largest = value;
      if (r.source === "credit") creditTotal += value;
      const key = r.category?.name ?? "לא מסווג";
      const existing = byCat.get(key);
      if (existing) existing.value += value;
      else
        byCat.set(key, {
          name: key,
          color: r.category?.color ?? UNCATEGORIZED_COLOR,
          icon: r.category?.icon ?? undefined,
          value,
        });
    }
    return {
      count,
      largest,
      creditTotal,
      manualTotal: total - creditTotal,
      average: count > 0 ? total / count : 0,
      slices: [...byCat.values()],
    };
  }, [expenses, total]);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm(monthKey));
    setError("");
    setFormOpen(true);
  }

  function openEdit(expense: Expense) {
    setEditing(expense);
    setForm({
      amount: Number(expense.amount),
      expenseDate: expense.expenseDate.slice(0, 10),
      categoryId: expense.categoryId,
      paymentMethodId: expense.paymentMethodId,
      businessName: expense.businessName ?? "",
      description: expense.description ?? "",
      isRecurring: expense.isRecurring,
    });
    setError("");
    setFormOpen(true);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const payload = { ...form, businessName: form.businessName || null, description: form.description || null };
      if (editing) await updateExpense(editing.id, payload);
      else await createExpense(payload);
      setFormOpen(false);
      load();
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function remove(expense: Expense) {
    if (!window.confirm(`למחוק את ההוצאה "${expense.businessName || expense.description || ""}"?`)) return;
    await deleteExpense(expense.id);
    load();
  }

  async function onImportFile(file: File) {
    setImportMessage("");
    try {
      const result = await importExpensesFile(file, monthKey);
      setImportMessage(`יובאו ${result.created} הוצאות בסך ${formatCurrency(result.totalAmount)} (${result.skipped} דולגו)`);
      load();
    } catch (err) {
      setImportMessage(apiErrorMessage(err));
    }
  }

  if (!expenses) return <Loading />;

  const columns: Column<Expense>[] = [
    { key: "date", header: "תאריך", render: (row) => formatDate(row.expenseDate) },
    {
      key: "name",
      header: "שם / בית עסק",
      render: (row) => (
        <span>
          {row.isRecurring && <span title="תשלום קבוע">🔁 </span>}
          {row.businessName || row.description || "—"}
          {row.source === "credit" && (
            <span className="badge badge-credit" title="עסקה מדוח כרטיס אשראי — נערכת בטאב אשראי">
              💳 אשראי
            </span>
          )}
        </span>
      ),
    },
    {
      key: "category",
      header: "קטגוריה",
      render: (row) =>
        row.category ? (
          <span>
            {row.category.icon} {row.category.name}
          </span>
        ) : (
          <span className="text-muted">לא מסווג</span>
        ),
    },
    {
      key: "method",
      header: "אמצעי תשלום",
      render: (row) => row.paymentMethod?.name ?? (row.source === "credit" ? "כרטיס אשראי" : "—"),
    },
    {
      key: "amount",
      header: "סכום",
      align: "left",
      render: (row) => <span className="mono text-danger">{formatCurrency(Number(row.amount))}</span>,
    },
    {
      key: "actions",
      header: "",
      align: "left",
      render: (row) =>
        row.source === "credit" ? (
          <span className="text-muted" title="עסקת אשראי — לעריכה עברי לטאב אשראי">🔒</span>
        ) : (
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
        <Button onClick={openCreate}>+ הוספת הוצאה</Button>
        <Button variant="outline" onClick={() => fileRef.current?.click()}>
          ייבוא אקסל 📂
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onImportFile(file);
            e.target.value = "";
          }}
        />
        <Select
          options={expenseCategories.map((c) => ({ value: c.id, label: `${c.icon ?? ""} ${c.name}` }))}
          placeholder="כל הקטגוריות"
          value={filterCategory ?? ""}
          onChange={(e) => setFilterCategory(e.target.value ? Number(e.target.value) : undefined)}
        />
      </div>

      {importMessage && <div className="info-banner">{importMessage}</div>}

      {progress && (progress.target != null || progress.isCurrentMonth) && (
        <MonthProgressPanel progress={progress} onSaveTarget={saveTarget} />
      )}

      {expenses.length > 0 && (
        <div className="expenses-overview">
          <div className="stats-strip">
            <SummaryCard label="סה״כ החודש" value={formatCurrency(total)} tone="danger" />
            <SummaryCard label="מספר עסקאות" value={String(stats.count)} />
            <SummaryCard label="הוצאה ממוצעת" value={formatCurrency(stats.average)} />
            {stats.creditTotal > 0 ? (
              <SummaryCard
                label="מתוכן אשראי"
                value={formatCurrency(stats.creditTotal)}
                sub={`מזומן / אחר: ${formatCurrency(stats.manualTotal)}`}
              />
            ) : (
              <SummaryCard label="ההוצאה הגדולה" value={formatCurrency(stats.largest)} />
            )}
          </div>
          {stats.slices.length > 0 && (
            <Card title="הוצאות לפי קטגוריה">
              <CategoryBarChart data={stats.slices} />
            </Card>
          )}
        </div>
      )}

      <Card>
        <Table
          columns={columns}
          rows={expenses}
          rowKey={(row) => `${row.source ?? "manual"}-${row.id}`}
          emptyState={<EmptyState icon="🧾" title="אין הוצאות החודש" hint="הוסיפי הוצאה, ייבאי אקסל, או ייבאי דוח אשראי בטאב אשראי" />}
        />
      </Card>

      <Modal title={editing ? "עריכת הוצאה" : "הוספת הוצאה"} open={formOpen} onClose={() => setFormOpen(false)}>
        <form onSubmit={submit}>
          {error && <ErrorMessage message={error} />}
          <div className="form-row">
            <Input
              label="סכום (₪)"
              type="number"
              step="0.01"
              min="0.01"
              required
              value={form.amount || ""}
              onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })}
            />
            <Input
              label="תאריך"
              type="date"
              required
              value={form.expenseDate}
              onChange={(e) => setForm({ ...form, expenseDate: e.target.value })}
            />
          </div>
          <Input
            label="שם / בית עסק"
            value={form.businessName ?? ""}
            onChange={(e) => setForm({ ...form, businessName: e.target.value })}
          />
          <div className="form-row">
            <Select
              label="קטגוריה"
              options={expenseCategories.map((c) => ({ value: c.id, label: `${c.icon ?? ""} ${c.name}` }))}
              placeholder="ללא קטגוריה"
              value={form.categoryId ?? ""}
              onChange={(e) => setForm({ ...form, categoryId: e.target.value ? Number(e.target.value) : null })}
            />
            <Select
              label="אמצעי תשלום"
              options={paymentMethods.map((m) => ({ value: m.id, label: m.name }))}
              placeholder="ללא"
              value={form.paymentMethodId ?? ""}
              onChange={(e) => setForm({ ...form, paymentMethodId: e.target.value ? Number(e.target.value) : null })}
            />
          </div>
          <Input
            label="הערה"
            value={form.description ?? ""}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
          <div className="modal-actions">
            <Button type="submit" disabled={saving}>
              {saving ? "שומר..." : editing ? "עדכון" : "הוספה"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setFormOpen(false)}>
              ביטול
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
