import { TransactionFilters } from "../components/common/TransactionFilters";
import { useLedgerQuery } from "../hooks/useLedgerQuery";
import { ExpenseEditor } from "../components/expenses/ExpenseEditor";
import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { AsyncSection } from "../components/common/AsyncSection";
import { Button } from "../components/common/Button";
import { Card } from "../components/common/Card";
import { useConfirm } from "../hooks/useConfirm";
import { EmptyState } from "../components/common/EmptyState";
import { Modal } from "../components/common/Modal";
import { PageShell } from "../components/common/PageShell";
import { SkeletonRows } from "../components/common/Skeleton";
import { Table, type Column } from "../components/common/Table";
import { Pager } from "../components/common/Pager";
import { useMonth } from "../context/MonthContext";
import { useAsync } from "../hooks/useAsync";
import { useLookups } from "../hooks/useLookups";
import {
  deleteExpense,
  listExpenseLedger,
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
  const ledger = useLedgerQuery("expenses", monthKey);
  const { expenseCategories } = useLookups();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [form, setForm] = useState<ExpenseInput>(emptyForm(monthKey));
  const [reloadKey, setReloadKey] = useState(0);

  const expensesRes = useAsync(
    () => listExpenseLedger(monthKey, ledger.filters, ledger.page),
    [monthKey, reloadKey, ledger.filterKey, ledger.page],
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

  const filtersActive = ledger.active;

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
    { key: "date", priority: "secondary", header: "תאריך", render: (row) => formatDate(row.expenseDate) },
    {
      key: "name",
      priority: "primary",
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
      priority: "secondary",
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
      priority: "secondary",
      header: "אמצעי תשלום",
      render: (row) => row.paymentMethod?.name ?? (row.source === "credit" ? "כרטיס אשראי" : "—"),
    },
    {
      key: "amount",
      priority: "amount",
      header: "סכום",
      align: "left",
      render: (row) => <span className={Number(row.amount) < 0 ? "mono text-success" : "mono"}>{formatCurrency(Number(row.amount))}{Number(row.amount) < 0 && <span className="sr-only"> זיכוי</span>}</span>,
    },
    {
      key: "actions",
      header: "",
      align: "left",
      render: (row) =>
        row.source === "credit" ? (
          <Link className="ledger-source-link" to="/accounts?tab=credit" aria-label="פתיחת עסקאות הכרטיס">לכרטיס ←</Link>
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
        <AsyncSection
          resource={expensesRes}
          errorTitle="לא הצלחנו לטעון את התנועות"
          skeleton={<SkeletonRows rows={6} />}
        >
          {data => (<>
            <div className="ledger-summary"><div><span className="ledger-summary-label">הוצאות החודש</span><strong className="mono">{formatCurrency(data.monthTotal)}</strong></div><span className="text-muted">{data.monthCount} תנועות רשומות</span></div>
            <TransactionFilters kind="expenses" options={expenseCategories.map(c => ({ value: c.id, label: c.name }))}/>
            <p className="ledger-count" role="status">{data.filteredCount} תנועות בסינון{filtersActive && <> · <strong className="mono">{formatCurrency(data.filteredTotal)}</strong></>}</p>
            <Table
              variant="ledger"
              columns={columns}
              rows={data.items}
              pageSize={0}
              rowKey={(row) => `${row.source ?? "manual"}-${row.id}`}
              emptyState={
                /* "אין נתונים" and "המסנן חתך הכול" need opposite actions, so they
                   must not share one message (§4.5). */
                data.monthCount > 0 || filtersActive ? (
                  <EmptyState
                    icon="🔍"
                    title="אין תוצאות למסננים הנוכחיים"
                    action={
                      <Button size="sm" variant="outline" onClick={ledger.clear}>
                        ניקוי מסננים
                      </Button>
                    }
                  />
                ) : (
                  <EmptyState
                    icon="🧾"
                    title="אין הוצאות החודש"
                    hint="אפשר להוסיף הוצאה או להעלות דוח כדי להתחיל."
                    action={
                      <Button size="sm" onClick={openCreate}>
                        + הוספת הוצאה
                      </Button>
                    }
                  />
                )
              }
            />
            <Pager page={data.page} pageSize={data.pageSize} total={data.filteredCount} onChange={ledger.setPage} />
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
