import { TransactionFilters } from "../components/common/TransactionFilters";
import { useLedgerQuery } from "../hooks/useLedgerQuery";
import { lazy, Suspense, useMemo, useState, type FormEvent } from "react";
import { AsyncSection } from "../components/common/AsyncSection";
import { Button } from "../components/common/Button";
import { Card } from "../components/common/Card";
import { useConfirm } from "../hooks/useConfirm";
import { EmptyState } from "../components/common/EmptyState";
import { ErrorMessage } from "../components/common/ErrorMessage";
import { Input } from "../components/common/Input";
import { Modal } from "../components/common/Modal";
import { PageShell } from "../components/common/PageShell";
import { Select } from "../components/common/Select";
import { SkeletonChart, SkeletonKpiRow, SkeletonRows } from "../components/common/Skeleton";
import { Table, type Column } from "../components/common/Table";
import { Pager } from "../components/common/Pager";
const CategoryBarChart=lazy(()=>import("../components/dashboard/CategoryBarChart").then(module=>({default:module.CategoryBarChart})));
import { SummaryCard } from "../components/dashboard/SummaryCard";
import { useMonth } from "../context/MonthContext";
import { useAsync } from "../hooks/useAsync";
import { apiErrorMessage } from "../services/api";
import { createIncome, deleteIncome, listIncomeLedger, updateIncome, type IncomeInput } from "../services/finance.service";
import type { Income } from "../types/models";
import { formatCurrency, formatDate } from "../utils/format";

const INCOME_TYPES = [
  { value: "salary", label: "משכורת" },
  { value: "extra", label: "תוספת" },
  { value: "business", label: "עסק" },
  { value: "allowance", label: "קצבה" },
  { value: "refund", label: "החזר" },
  { value: "gift", label: "מתנה" },
  { value: "one_time", label: "חד־פעמי" },
  { value: "recurring", label: "קבוע" },
];

const typeLabel = (type: string) => INCOME_TYPES.find((t) => t.value === type)?.label ?? type;

const emptyForm = (monthKey: string): IncomeInput => ({
  amount: 0,
  type: "salary",
  description: "",
  incomeDate: `${monthKey}-01`,
});

export default function IncomesPage() {
  const confirm = useConfirm();
  const [analysisOpen,setAnalysisOpen]=useState(false);
  const { monthKey } = useMonth();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Income | null>(null);
  const [form, setForm] = useState<IncomeInput>(emptyForm(monthKey));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const ledger = useLedgerQuery("incomes", monthKey);
  const incomesRes = useAsync(() => listIncomeLedger(monthKey, ledger.filters, ledger.page), [monthKey, reloadKey, ledger.filterKey, ledger.page], "לא הצלחנו לטעון את ההכנסות", ["incomes","imports","bank","documents"]);
  const load = () => setReloadKey((k) => k + 1);

  // Grouped on the server over the filtered rows; the month total stays monthTotals' figure (CLAUDE.md §4).
  const byType = useMemo(() => {
    const palette = ["#34d399", "#60a5fa", "#f472b6", "#fbbf24", "#a78bfa", "#22d3ee", "#fb7185", "#94a3b8"];
    return (incomesRes.data?.byType ?? []).map((group, index) => ({ name: group.label, color: palette[index % palette.length]!, value: group.amount }));
  }, [incomesRes.data]);

  const filtered = ledger.active;
  const biggest = byType.length > 0 ? [...byType].sort((a, b) => b.value - a.value)[0] : null;

  function openCreate() {
    setEditing(null);
    setForm(emptyForm(monthKey));
    setError("");
    setFormOpen(true);
  }

  function openEdit(income: Income) {
    setEditing(income);
    setForm({
      amount: Number(income.amount),
      type: income.type,
      description: income.description ?? "",
      incomeDate: income.incomeDate.slice(0, 10),
      isRecurring: income.isRecurring,
    });
    setError("");
    setFormOpen(true);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const payload = { ...form, description: form.description || null };
      if (editing) await updateIncome(editing.id, payload);
      else await createIncome(payload);
      setFormOpen(false);
      load();
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  function remove(income: Income) {
    confirm.ask(
      {
        title: "מחיקת הכנסה",
        message: (
          <>
            ההכנסה <strong>{income.description || typeLabel(income.type)}</strong> תימחק.
            <span className="confirm-consequence">היתרה החודשית ושיעור החיסכון יחושבו מחדש.</span>
          </>
        ),
        confirmLabel: "מחיקה",
        tone: "danger",
      },
      async () => {
        await deleteIncome(income.id);
        load();
      }
    );
  }

  const columns: Column<Income>[] = [
    { key: "date", priority: "secondary", header: "תאריך", render: (row) => formatDate(row.incomeDate) },
    { key: "desc", priority: "primary", header: "תיאור", render: (row) => row.description || "—" },
    { key: "type", priority: "secondary", header: "סוג", render: (row) => typeLabel(row.type) },
    {
      key: "amount",
      priority: "amount",
      header: "סכום",
      align: "left",
      render: (row) => <span className="mono text-success">{formatCurrency(Number(row.amount))}</span>,
    },
    {
      key: "actions",
      header: "",
      align: "left",
      render: (row) => (
        <span className="row-actions">
          <Button size="sm" variant="ghost" onClick={() => openEdit(row)} aria-label="עריכה">✏️</Button>
          <Button size="sm" variant="ghost" onClick={() => remove(row)} aria-label="מחיקה">🗑️</Button>
        </span>
      ),
    },
  ];

  return (
    <PageShell
      toolbar={<Button onClick={openCreate}>+ הוספת הכנסה</Button>}

    >
      <Card>
        <AsyncSection
          resource={incomesRes}
          errorTitle="לא הצלחנו לטעון את ההכנסות"
          skeleton={<SkeletonRows rows={5} />}
        >
          {data => (<>
            <div className="ledger-summary"><div><span className="ledger-summary-label">הכנסות החודש</span><strong className="mono">{formatCurrency(data.monthTotal)}</strong></div><span className="text-muted">{data.monthCount} תנועות רשומות</span></div>
            <TransactionFilters kind="incomes" options={INCOME_TYPES}/>
            <p className="ledger-count" role="status">{data.filteredCount} תנועות בסינון{filtered && <> · <strong className="mono">{formatCurrency(data.filteredTotal)}</strong></>}</p>
            <Table
              variant="ledger"
              columns={columns}
              rows={data.items}
              pageSize={0}
              rowKey={(row) => row.id}
              emptyState={
                filtered ? (
                  <EmptyState
                    icon="🔍"
                    title="אין הכנסות שמתאימות לסינון"
                    hint="אפשר לנקות את הסינון ולראות את כל ההכנסות של החודש"
                    action={
                      <Button size="sm" variant="outline" onClick={ledger.clear}>
                        ניקוי הסינון
                      </Button>
                    }
                  />
                ) : (
                  <EmptyState
                    icon="💰"
                    title="אין הכנסות החודש"
                    hint="הוסיפי משכורת, קצבה או כל הכנסה אחרת"
                    action={
                      <Button size="sm" onClick={openCreate}>
                        + הוספת הכנסה
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

      <details className="home-analysis" onToggle={e=>setAnalysisOpen(e.currentTarget.open)}><summary>ניתוח ההכנסות</summary>{analysisOpen&&<><AsyncSection
          resource={incomesRes}
          errorTitle="לא הצלחנו לטעון את סיכום ההכנסות"
          skeleton={<SkeletonKpiRow count={4} label="טוען סיכום הכנסות" />}
        >
          {(data) => (
            <div className="kpi-row">
              <SummaryCard
                label="סה״כ הכנסות"
                value={formatCurrency(data.monthTotal)}
                icon="💰"
                tone="success"
                size="hero"
              />
              <SummaryCard label="מספר הכנסות" value={String(data.monthCount)} icon="🧾" />
              <SummaryCard
                label="המקור הגדול"
                value={biggest ? biggest.name : "—"}
                icon="🏆"
                sub={biggest ? formatCurrency(biggest.value) : undefined}
              />
              <SummaryCard
                label="הכנסות קבועות"
                value={String(data.recurringCount)}
                icon="🔁"
                sub={data.recurringCount > 0 ? "חוזרות כל חודש" : "אין הכנסה קבועה מוגדרת"}
              />
            </div>
          )}
        </AsyncSection>
        <AsyncSection
          resource={incomesRes}
          errorTitle="לא הצלחנו לטעון את פילוח ההכנסות"
          skeleton={<SkeletonChart height={200} label="טוען פילוח" />}
          isEmpty={() => byType.length === 0}
          emptyState={<></>}
        >
          {() => (
            <Card title="הכנסות לפי סוג">
              <Suspense fallback={<SkeletonChart/>}><CategoryBarChart data={byType} /></Suspense>
            </Card>
          )}
        </AsyncSection></>}</details>
      <Modal title={editing ? "עריכת הכנסה" : "הוספת הכנסה"} open={formOpen} onClose={() => setFormOpen(false)}>
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
              value={form.incomeDate}
              onChange={(e) => setForm({ ...form, incomeDate: e.target.value })}
            />
          </div>
          <div className="form-row">
            <Select
              label="סוג הכנסה"
              options={INCOME_TYPES}
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value })}
            />
            <Input
              label="תיאור"
              value={form.description ?? ""}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>
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
