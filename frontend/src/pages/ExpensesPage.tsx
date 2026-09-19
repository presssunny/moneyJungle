import { useTransactionFilters } from "../hooks/useTransactionFilters";
import { ExpenseEditor } from "../components/expenses/ExpenseEditor";
import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { AsyncSection } from "../components/common/AsyncSection";
import { Button } from "../components/common/Button";
import { Card } from "../components/common/Card";
import { useConfirm } from "../components/common/ConfirmDialog";
import { EmptyState } from "../components/common/EmptyState";
import { Input } from "../components/common/Input";
import { Modal } from "../components/common/Modal";
import { PageShell } from "../components/common/PageShell";
import { Select } from "../components/common/Select";
import { SkeletonRows } from "../components/common/Skeleton";
import { Table, type Column } from "../components/common/Table";
import { useMonth } from "../context/MonthContext";
import { useAsync } from "../hooks/useAsync";
import { useLookups } from "../hooks/useLookups";
import {
  deleteExpense,
  listExpenses,
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
  const navigate = useNavigate();
  const { params, set, clear: clearFilters } = useTransactionFilters();
  const { expenseCategories } = useLookups();
  const filterCategory = params.get("category") ? Number(params.get("category")) : undefined;
  const search = params.get("q") ?? "";
  const onlyUncategorized = params.get("uncat") === "1";
  const onlyRecurring = params.get("recurring") === "1";
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [form, setForm] = useState<ExpenseInput>(emptyForm(monthKey));
  const [reloadKey, setReloadKey] = useState(0);

  const expensesRes = useAsync(
    () => listExpenses(monthKey),
    [monthKey, reloadKey],
    "לא הצלחנו לטעון את התנועות", ["expenses","imports","credit","bank","categories","payment-methods","settings","documents"]
  );

  const load = () => setReloadKey((k) => k + 1);

  // The dashboard's "הוספת הוצאה" button lands here with openForm state
  useEffect(() => {
    if ((location.state as { openForm?: boolean } | null)?.openForm) {
      setForm(emptyForm(monthKey));
      setFormOpen(true);
      navigate(location.pathname + location.search, { replace: true, state: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const allRows = useMemo(() => expensesRes.data?.expenses ?? [], [expensesRes.data]);

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return allRows.filter((row) => {
      if (filterCategory !== undefined && row.categoryId !== filterCategory) return false;
      if (from && row.expenseDate.slice(0,10) < from || to && row.expenseDate.slice(0,10) > to) return false;
      if (onlyUncategorized && row.categoryId !== null) return false;
      if (onlyRecurring && !row.isRecurring) return false;
      if (needle) {
        const haystack = `${row.businessName ?? ""} ${row.description ?? ""} ${row.category?.name ?? ""}`.toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });
  }, [allRows, search, onlyUncategorized, onlyRecurring, filterCategory, from, to]);

  const filtersActive = search.trim() !== "" || onlyUncategorized || onlyRecurring || filterCategory !== undefined || !!from || !!to;

  function openCreate() {
    setEditing(null);
    setForm(emptyForm(monthKey));
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
    setFormOpen(true);
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
          <Button variant="outline" onClick={() => navigate('/imports')}>ייבוא דוח 📂</Button>
        </>
      }
    >



      <Card>
        <div className="filter-bar">
          <Input
            placeholder="חיפוש בית עסק / תיאור…"
            value={search}
            onChange={(e) => set("q", e.target.value)}
            aria-label="חיפוש חופשי"
          />
          <Select
            options={expenseCategories.map((c) => ({ value: c.id, label: `${c.icon ?? ""} ${c.name}` }))}
            placeholder="כל הקטגוריות"
            value={filterCategory ?? ""}
            onChange={(e) => set("category", e.target.value)}
            aria-label="סינון לפי קטגוריה"
          />
          <label className="filter-toggle">
            <input
              type="checkbox"
              checked={onlyUncategorized}
              onChange={(e) => set("uncat", e.target.checked ? "1" : "")}
            />
            רק לא מסווגות
          </label>
          <label className="filter-toggle">
            <input type="checkbox" checked={onlyRecurring} onChange={(e) => set("recurring", e.target.checked ? "1" : "")} />
            רק תשלומים קבועים
          </label>
          <Input type="date" aria-label="מתאריך" value={from} onChange={e => set("from", e.target.value)}/>
          <Input type="date" aria-label="עד תאריך" value={to} onChange={e => set("to", e.target.value)}/>
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
          {data => (<>
            <p role="status">{rows.length} תנועות בסינון · {formatCurrency(rows.reduce((sum,row) => sum + Math.round(Number(row.amount)*100),0)/100)} · סך החודש: {formatCurrency(data.total)}</p>
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
          </>)}
        </AsyncSection>
      </Card>

      <Modal title={editing ? "עריכת הוצאה" : "הוספת הוצאה"} open={formOpen} onClose={() => setFormOpen(false)}>
        <ExpenseEditor key={editing?.id ?? "new"} expenseId={editing?.id} initial={form} onSaved={() => { setFormOpen(false); load(); }} onCancel={() => setFormOpen(false)} />
      </Modal>

      {confirm.dialog}
    </PageShell>
  );
}
