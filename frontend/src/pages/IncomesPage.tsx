import { useMemo, useState, type FormEvent } from "react";
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
import { SkeletonChart, SkeletonKpiRow, SkeletonRows } from "../components/common/Skeleton";
import { Table, type Column } from "../components/common/Table";
import { CategoryBarChart } from "../components/dashboard/CategoryBarChart";
import { SummaryCard } from "../components/dashboard/SummaryCard";
import { useMonth } from "../context/MonthContext";
import { useAsync } from "../hooks/useAsync";
import { apiErrorMessage } from "../services/api";
import { createIncome, deleteIncome, listIncomes, updateIncome, type IncomeInput } from "../services/finance.service";
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
  const { monthKey } = useMonth();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Income | null>(null);
  const [form, setForm] = useState<IncomeInput>(emptyForm(monthKey));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const incomesRes = useAsync(() => listIncomes(monthKey), [monthKey, reloadKey], "לא הצלחנו לטעון את ההכנסות");
  const load = () => setReloadKey((k) => k + 1);

  // Filters, matching the expenses screen. The two sides of the same month were
  // asymmetric: expenses had search, filtering and a breakdown; incomes had a
  // bare table (UX audit §4).
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<string>("");

  const allRows = useMemo(() => incomesRes.data?.incomes ?? [], [incomesRes.data]);
  const rows = useMemo(() => {
    const term = search.trim();
    return allRows.filter((row) => {
      if (filterType && row.type !== filterType) return false;
      if (term && !(row.description ?? "").includes(term) && !typeLabel(row.type).includes(term)) return false;
      return true;
    });
  }, [allRows, search, filterType]);

  /**
   * Income split by kind, for the visible rows. This groups rows the server
   * already returned — the authoritative month total stays `data.total` from the
   * API (CLAUDE.md §4), exactly as the expenses screen does it.
   */
  const byType = useMemo(() => {
    const palette = ["#34d399", "#60a5fa", "#f472b6", "#fbbf24", "#a78bfa", "#22d3ee", "#fb7185", "#94a3b8"];
    const sums = new Map<string, number>();
    for (const row of rows) sums.set(row.type, (sums.get(row.type) ?? 0) + Number(row.amount));
    return [...sums.entries()].map(([type, value], index) => ({
      name: typeLabel(type),
      color: palette[index % palette.length]!,
      value,
    }));
  }, [rows]);

  const filtered = rows.length !== allRows.length;
  const biggest = byType.length > 0 ? [...byType].sort((a, b) => b.value - a.value)[0] : null;
  const recurringCount = allRows.filter((row) => row.isRecurring).length;

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
    { key: "date", header: "תאריך", render: (row) => formatDate(row.incomeDate) },
    { key: "desc", header: "תיאור", render: (row) => row.description || "—" },
    { key: "type", header: "סוג", render: (row) => typeLabel(row.type) },
    {
      key: "amount",
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
      summary={
        <AsyncSection
          resource={incomesRes}
          errorTitle="לא הצלחנו לטעון את סיכום ההכנסות"
          skeleton={<SkeletonKpiRow count={4} label="טוען סיכום הכנסות" />}
        >
          {(data) => (
            <div className="kpi-row">
              <SummaryCard
                label="סה״כ הכנסות"
                value={formatCurrency(data.total)}
                icon="💰"
                tone="success"
                size="hero"
              />
              <SummaryCard label="מספר הכנסות" value={String(data.incomes.length)} icon="🧾" />
              <SummaryCard
                label="המקור הגדול"
                value={biggest ? biggest.name : "—"}
                icon="🏆"
                sub={biggest ? formatCurrency(biggest.value) : undefined}
              />
              <SummaryCard
                label="הכנסות קבועות"
                value={String(recurringCount)}
                icon="🔁"
                sub={recurringCount > 0 ? "חוזרות כל חודש" : "אין הכנסה קבועה מוגדרת"}
              />
            </div>
          )}
        </AsyncSection>
      }
      charts={
        <AsyncSection
          resource={incomesRes}
          errorTitle="לא הצלחנו לטעון את פילוח ההכנסות"
          skeleton={<SkeletonChart height={200} label="טוען פילוח" />}
          isEmpty={() => byType.length === 0}
          emptyState={<></>}
        >
          {() => (
            <Card title="הכנסות לפי סוג">
              <CategoryBarChart data={byType} />
            </Card>
          )}
        </AsyncSection>
      }
    >
      <Card>
        <div className="filter-bar">
          <Input
            placeholder="חיפוש בתיאור / סוג…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="חיפוש חופשי"
          />
          <Select
            options={INCOME_TYPES}
            placeholder="כל הסוגים"
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            aria-label="סינון לפי סוג הכנסה"
          />
          {filtered && (
            <span className="filter-strip-note">
              {rows.length} מתוך {allRows.length}
              <Button size="sm" variant="ghost" onClick={() => { setSearch(""); setFilterType(""); }}>
                ניקוי הסינון
              </Button>
            </span>
          )}
        </div>
        <AsyncSection
          resource={incomesRes}
          errorTitle="לא הצלחנו לטעון את ההכנסות"
          skeleton={<SkeletonRows rows={5} />}
        >
          {() => (
            <Table
              columns={columns}
              rows={rows}
              rowKey={(row) => row.id}
              emptyState={
                filtered ? (
                  <EmptyState
                    icon="🔍"
                    title="אין הכנסות שמתאימות לסינון"
                    hint="אפשר לנקות את הסינון ולראות את כל ההכנסות של החודש"
                    action={
                      <Button size="sm" variant="outline" onClick={() => { setSearch(""); setFilterType(""); }}>
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
          )}
        </AsyncSection>
      </Card>

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
