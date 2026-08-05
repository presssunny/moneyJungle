import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
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
import { SkeletonRows } from "../components/common/Skeleton";
import { Table, type Column } from "../components/common/Table";
import { useMonth } from "../context/MonthContext";
import { useAsync } from "../hooks/useAsync";
import { useLookups } from "../hooks/useLookups";
import { apiErrorMessage } from "../services/api";
import {
  createExpense,
  deleteExpense,
  importExpensesFile,
  listExpenses,
  updateExpense,
  type ExpenseInput,
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

/**
 * The expenses table (sub-tab of טאב "תנועות") — the table plus its local
 * filters, nothing else. The KPI row, category chart and pace panel live on
 * `TransactionsPage` and `BudgetsPage`, so no number is a KPI card twice (§1.1).
 */
export default function ExpensesPage() {
  const confirm = useConfirm();
  const { monthKey } = useMonth();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const { expenseCategories, paymentMethods } = useLookups();
  const [filterCategory, setFilterCategory] = useState<number | undefined>();
  const [search, setSearch] = useState("");
  // Entry point from the "לא מסווגות" KPI on the hub above.
  const [onlyUncategorized, setOnlyUncategorized] = useState(params.get("uncat") === "1");
  const [onlyRecurring, setOnlyRecurring] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [form, setForm] = useState<ExpenseInput>(emptyForm(monthKey));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [importMessage, setImportMessage] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  const expensesRes = useAsync(
    () => listExpenses(monthKey, filterCategory),
    [monthKey, filterCategory, reloadKey],
    "לא הצלחנו לטעון את התנועות"
  );

  const load = () => setReloadKey((k) => k + 1);

  // The dashboard's "הוספת הוצאה" button lands here with openForm state
  useEffect(() => {
    if ((location.state as { openForm?: boolean } | null)?.openForm) {
      setForm(emptyForm(monthKey));
      setFormOpen(true);
      window.history.replaceState({}, "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const allRows = useMemo(() => expensesRes.data?.expenses ?? [], [expensesRes.data]);

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return allRows.filter((row) => {
      if (onlyUncategorized && row.categoryId !== null) return false;
      if (onlyRecurring && !row.isRecurring) return false;
      if (needle) {
        const haystack = `${row.businessName ?? ""} ${row.description ?? ""} ${row.category?.name ?? ""}`.toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });
  }, [allRows, search, onlyUncategorized, onlyRecurring]);

  const filtersActive = search.trim() !== "" || onlyUncategorized || onlyRecurring || filterCategory !== undefined;

  function clearFilters() {
    setSearch("");
    setOnlyUncategorized(false);
    setOnlyRecurring(false);
    setFilterCategory(undefined);
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("uncat");
        return next;
      },
      { replace: true }
    );
  }

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

  function remove(expense: Expense) {
    const label = expense.businessName || expense.description || "ההוצאה";
    confirm.ask(
      {
        title: "מחיקת הוצאה",
        message: (
          <>
            <strong>{label}</strong> תימחק.
            <span className="confirm-consequence">סכומי החודש והתקציב יתעדכנו בהתאם.</span>
          </>
        ),
        confirmLabel: "מחיקה",
        tone: "danger",
      },
      async () => {
        await deleteExpense(expense.id);
        load();
      }
    );
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
          <span className="text-warning">לא מסווג</span>
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
            <Button size="sm" variant="ghost" onClick={() => openEdit(row)} aria-label="עריכה">✏️</Button>
            <Button size="sm" variant="ghost" onClick={() => remove(row)} aria-label="מחיקה">🗑️</Button>
          </span>
        ),
    },
  ];

  return (
    <PageShell
      toolbar={
        <>
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
        </>
      }
    >

      {importMessage && <div className="info-banner">{importMessage}</div>}

      <Card>
        <div className="filter-bar">
          <Input
            placeholder="חיפוש בית עסק / תיאור…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="חיפוש חופשי"
          />
          <Select
            options={expenseCategories.map((c) => ({ value: c.id, label: `${c.icon ?? ""} ${c.name}` }))}
            placeholder="כל הקטגוריות"
            value={filterCategory ?? ""}
            onChange={(e) => setFilterCategory(e.target.value ? Number(e.target.value) : undefined)}
            aria-label="סינון לפי קטגוריה"
          />
          <label className="filter-toggle">
            <input
              type="checkbox"
              checked={onlyUncategorized}
              onChange={(e) => setOnlyUncategorized(e.target.checked)}
            />
            רק לא מסווגות
          </label>
          <label className="filter-toggle">
            <input type="checkbox" checked={onlyRecurring} onChange={(e) => setOnlyRecurring(e.target.checked)} />
            רק תשלומים קבועים
          </label>
          {filtersActive && (
            <Button size="sm" variant="ghost" onClick={clearFilters}>
              ניקוי מסננים ✕
            </Button>
          )}
        </div>

        <AsyncSection
          resource={expensesRes}
          errorTitle="לא הצלחנו לטעון את התנועות"
          skeleton={<SkeletonRows rows={6} />}
        >
          {() => (
            <Table
              columns={columns}
              rows={rows}
              rowKey={(row) => `${row.source ?? "manual"}-${row.id}`}
              emptyState={
                /* "אין נתונים" and "המסנן חתך הכול" need opposite actions, so they
                   must not share one message (§4.5). */
                allRows.length > 0 || filtersActive ? (
                  <EmptyState
                    icon="🔍"
                    title="אין תוצאות למסננים הנוכחיים"
                    action={
                      <Button size="sm" variant="outline" onClick={clearFilters}>
                        ניקוי מסננים
                      </Button>
                    }
                  />
                ) : (
                  <EmptyState
                    icon="🧾"
                    title="אין הוצאות החודש"
                    hint="הוסיפי הוצאה, ייבאי אקסל, או ייבאי דוח אשראי בטאב חשבונות"
                    action={
                      <Button size="sm" onClick={openCreate}>
                        + הוספת הוצאה
                      </Button>
                    }
                  />
                )
              }
            />
          )}
        </AsyncSection>
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

      {confirm.dialog}
    </PageShell>
  );
}
