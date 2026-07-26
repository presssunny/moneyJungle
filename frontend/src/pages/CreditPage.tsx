import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AsyncSection } from "../components/common/AsyncSection";
import { Button } from "../components/common/Button";
import { Card } from "../components/common/Card";
import { EmptyState } from "../components/common/EmptyState";
import { Input } from "../components/common/Input";
import { Modal } from "../components/common/Modal";
import { Select } from "../components/common/Select";
import { SkeletonCard, SkeletonChart, SkeletonRows } from "../components/common/Skeleton";
import { Table, type Column } from "../components/common/Table";
import { WidgetError } from "../components/common/WidgetError";
import { CategoryBarChart } from "../components/dashboard/CategoryBarChart";
import { SummaryCard } from "../components/dashboard/SummaryCard";
import { useMonth } from "../context/MonthContext";
import { useAsync } from "../hooks/useAsync";
import { useLookups } from "../hooks/useLookups";
import { apiErrorMessage } from "../services/api";
import { getCharts } from "../services/dashboard.service";
import {
  confirmCreditImport,
  deleteCreditImport,
  getCreditImport,
  listCreditImports,
  recategorizeCredit,
  updateCreditTransaction,
  uploadCreditImport,
} from "../services/finance.service";
import { createRule } from "../services/planning.service";
import type { CreditImport, CreditImportDetail, CreditTransaction } from "../types/models";
import { currentMonthKey, formatCurrency, formatDate, formatMonthKey } from "../utils/format";

/**
 * טאב־משנה "אשראי" (IA §6.2).
 *
 * The KPI row is scoped to the **selected import** — that is the only credit
 * data actually loaded on this screen, so every card says so in its sub-line.
 * Claiming an account-wide number from one file would be a made-up figure.
 * "אשראי מתגלגל" is called out explicitly because CLAUDE.md §5 excludes it from
 * every expense total; without the note the number looks like a missing expense.
 */
export default function CreditPage() {
  const { monthKey, setMonthKey } = useMonth();
  const navigate = useNavigate();
  const { expenseCategories } = useLookups();
  const [selected, setSelected] = useState<CreditImportDetail | null>(null);
  const [detailError, setDetailError] = useState("");
  const [monthFilter, setMonthFilter] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState<string>("");
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [learn, setLearn] = useState<{ keyword: string; categoryId: number; categoryName: string } | null>(null);
  const [message, setMessage] = useState("");
  const [uploading, setUploading] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  const importsRes = useAsync(() => listCreditImports(), [reloadKey], "לא הצלחנו לטעון את ייבואי האשראי");
  const chartsRes = useAsync(() => getCharts(monthKey), [monthKey, reloadKey], "לא הצלחנו לטעון את פילוח האשראי");
  const imports = importsRes.data;

  const load = () => setReloadKey((k) => k + 1);

  function viewMonthOnDashboard(monthKey: string) {
    setMonthKey(monthKey);
    navigate("/");
  }

  // Auto-open the most recent import so its month-by-month split is visible
  // right away instead of hidden behind a click.
  useEffect(() => {
    if (!imports || imports.length === 0 || selected) return;
    let alive = true;
    getCreditImport(imports[0].id)
      .then((detail) => {
        if (alive) {
          setSelected(detail);
          setDetailError("");
        }
      })
      .catch((err: unknown) => {
        if (alive) setDetailError(apiErrorMessage(err, "לא הצלחנו לפתוח את הייבוא האחרון"));
      });
    return () => {
      alive = false;
    };
  }, [imports, selected]);

  async function onUpload(file: File) {
    setUploading(true);
    setMessage("");
    try {
      const detail = await uploadCreditImport(file, monthKey);
      setMonthFilter(null);
      // Nothing new in the file: no import was created, so there is nothing to
      // select or approve — say so instead of showing an empty import.
      if (detail.alreadyImported) {
        setMessage(
          detail.previousImport
            ? `⚠️ הדוח הזה כבר הועלה (${detail.previousImport.fileName}) — לא נוספה אף עסקה`
            : `⚠️ כל ${detail.parsedRows} העסקאות בקובץ כבר קיימות — לא נוסף כלום`
        );
        load();
        return;
      }
      setSelected(detail);
      const months = detail.monthlyBreakdown?.length ?? 1;
      const base =
        months > 1
          ? `נקלטו ${detail.totalTransactions} עסקאות ופוצלו ל־${months} חודשי חיוב — בדקי סיווג ואשרי`
          : `נקלטו ${detail.totalTransactions} עסקאות — בדקי סיווג ואשרי`;
      setMessage(
        detail.skippedDuplicates > 0
          ? `${base} · ${detail.skippedDuplicates} עסקאות דולגו (כבר היו קיימות)`
          : base
      );
      load();
    } catch (err) {
      setMessage(apiErrorMessage(err));
    } finally {
      setUploading(false);
    }
  }

  async function openImport(imp: CreditImport) {
    setMonthFilter(null);
    setSelected(await getCreditImport(imp.id));
  }

  async function confirm(id: number) {
    const detail = await confirmCreditImport(id);
    setSelected(detail);
    setMessage("הייבוא אושר — העסקאות נספרות עכשיו בהוצאות החודש");
    load();
  }

  async function removeImport(imp: CreditImport) {
    if (!window.confirm(`למחוק את הייבוא "${imp.fileName}" על כל העסקאות שבו?`)) return;
    await deleteCreditImport(imp.id);
    if (selected?.id === imp.id) setSelected(null);
    load();
  }

  async function setTransactionCategory(tx: CreditTransaction, categoryId: number | null) {
    await updateCreditTransaction(tx.id, categoryId);
    if (selected) setSelected(await getCreditImport(selected.id));
    // Offer to learn: create a rule so similar businesses classify automatically
    if (categoryId !== null) {
      const category = expenseCategories.find((c) => c.id === categoryId);
      const keyword = tx.businessName.trim().split(/[\s,\-/()]+/).filter(Boolean)[0] ?? tx.businessName.trim();
      if (category && keyword) {
        setLearn({ keyword, categoryId, categoryName: `${category.icon ?? ""} ${category.name}` });
      }
    }
  }

  async function confirmLearn() {
    if (!learn || !learn.keyword.trim()) return;
    try {
      await createRule({ keyword: learn.keyword.trim(), categoryId: learn.categoryId });
      const result = await recategorizeCredit();
      setMessage(`נוצר חוק · סווגו אוטומטית עוד ${result.categorized} עסקאות`);
      if (selected) setSelected(await getCreditImport(selected.id));
      load();
    } catch (err) {
      setMessage(apiErrorMessage(err));
    } finally {
      setLearn(null);
    }
  }

  async function reapplyRules() {
    const result = await recategorizeCredit();
    setMessage(`סווגו אוטומטית ${result.categorized} עסקאות מתוך ${result.scanned} שלא היו מסווגות`);
    if (selected) setSelected(await getCreditImport(selected.id));
    load();
  }

  // --- KPI inputs (§6.2) -------------------------------------------------
  // Everything below is a count/sum over rows that are already on screen; no
  // financial rule is recomputed. "financing" is shown separately because
  // CLAUDE.md §5 excludes it from expense totals.
  const pendingImports = (imports ?? []).filter((imp) => imp.status !== "confirmed");
  const pendingTransactions = pendingImports.reduce((sum, imp) => sum + imp.totalTransactions, 0);
  const selectedTransactions = selected?.transactions ?? [];
  const financingTotal = selectedTransactions
    .filter((tx) => tx.transactionType === "financing")
    .reduce((sum, tx) => sum + Number(tx.amount), 0);
  const uncategorizedCount = selectedTransactions.filter(
    (tx) => tx.categoryId === null && tx.transactionType !== "financing"
  ).length;
  const thisMonth = currentMonthKey();
  const nextBilling =
    (selected?.monthlyBreakdown ?? []).filter((m) => m.monthKey >= thisMonth).sort((a, b) => a.monthKey.localeCompare(b.monthKey))[0] ??
    null;

  const monthRange = (row: CreditImport) => {
    if (row.firstBillingDate && row.lastBillingDate) {
      const first = formatMonthKey(row.firstBillingDate.slice(0, 7));
      const last = formatMonthKey(row.lastBillingDate.slice(0, 7));
      return first === last ? first : `${last} – ${first}`;
    }
    return formatMonthKey(`${row.importYear}-${String(row.importMonth).padStart(2, "0")}`);
  };

  const importColumns: Column<CreditImport>[] = [
    { key: "file", header: "קובץ", render: (row) => row.fileName },
    { key: "months", header: "חודשי חיוב", render: (row) => monthRange(row) },
    { key: "count", header: "עסקאות", align: "center", render: (row) => row.totalTransactions },
    { key: "total", header: "הוצאה בפועל", align: "left", render: (row) => <span className="mono">{formatCurrency(row.totalAmount)}</span> },
    {
      key: "status",
      header: "סטטוס",
      render: (row) =>
        row.status === "confirmed" ? <span className="text-success">מאושר ✓</span> : <span className="text-warning">ממתין לאישור</span>,
    },
    {
      key: "actions",
      header: "",
      align: "left",
      render: (row) => (
        <span className="row-actions">
          <Button size="sm" variant="ghost" onClick={() => openImport(row)} aria-label="פתיחת הייבוא">👁️</Button>
          <Button size="sm" variant="ghost" onClick={() => removeImport(row)} aria-label="מחיקת הייבוא">🗑️</Button>
        </span>
      ),
    },
  ];

  const TYPE_BADGE: Record<string, { label: string; className: string }> = {
    standing_order: { label: "הוראת קבע", className: "tx-badge tx-badge-info" },
    credit: { label: "תשלומים", className: "tx-badge tx-badge-info" },
    refund: { label: "זיכוי", className: "tx-badge tx-badge-good" },
    financing: { label: "אשראי מתגלגל", className: "tx-badge tx-badge-muted" },
  };

  const txColumns: Column<CreditTransaction>[] = [
    { key: "date", header: "תאריך עסקה", render: (row) => formatDate(row.transactionDate) },
    { key: "charge", header: "מועד חיוב", render: (row) => (row.chargeDate ? formatDate(row.chargeDate) : "—") },
    {
      key: "business",
      header: "בית עסק",
      render: (row) => (
        <span>
          {row.businessName}
          {TYPE_BADGE[row.transactionType] && (
            <span className={TYPE_BADGE[row.transactionType].className}>{TYPE_BADGE[row.transactionType].label}</span>
          )}
        </span>
      ),
    },
    {
      key: "amount",
      header: "סכום",
      align: "left",
      render: (row) => {
        const amount = Number(row.amount);
        return <span className={`mono ${amount < 0 ? "text-success" : ""}`}>{formatCurrency(amount)}</span>;
      },
    },
    { key: "payments", header: "תשלומים", align: "center", render: (row) => (row.paymentCount > 1 ? row.paymentCount : "—") },
    {
      key: "category",
      header: "קטגוריה",
      render: (row) =>
        row.transactionType === "financing" ? (
          <span className="text-muted">— לא נספר —</span>
        ) : (
          <Select
            options={expenseCategories.map((c) => ({ value: c.id, label: `${c.icon ?? ""} ${c.name}` }))}
            placeholder="לא מסווג"
            value={row.categoryId ?? ""}
            onChange={(e) => setTransactionCategory(row, e.target.value ? Number(e.target.value) : null)}
          />
        ),
    },
  ];

  const searchLower = search.trim().toLowerCase();
  const filteredTransactions = (selected?.transactions ?? []).filter((t) => {
    if (monthFilter && t.billingDate.slice(0, 7) !== monthFilter) return false;
    if (searchLower && !t.businessName.toLowerCase().includes(searchLower)) return false;
    if (catFilter === "none" && t.categoryId !== null) return false;
    if (catFilter && catFilter !== "none" && String(t.categoryId) !== catFilter) return false;
    if (typeFilter && t.transactionType !== typeFilter) return false;
    return true;
  });

  return (
    <>
      <div className="page-toolbar">
        <Button onClick={() => fileRef.current?.click()} disabled={uploading}>
          {uploading ? "מעלה..." : "ייבוא דוח אשראי 📂"}
        </Button>
        <Button variant="outline" onClick={reapplyRules}>סיווג אוטומטי מחדש 🏷️</Button>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onUpload(file);
            e.target.value = "";
          }}
        />
        <span className="text-muted">
          מעלים קובץ מכל חברת אשראי (כאל / מקס / ישראכרט...) — העסקאות מפוצלות אוטומטית לפי חודש החיוב, מסווגות לפי חוקים, ותנועות "אשראי מתגלגל" לא נספרות כהוצאה
        </span>
      </div>

      {message && <div className="info-banner">{message}</div>}
      {detailError && (
        <WidgetError title="לא הצלחנו לפתוח את הייבוא האחרון" detail={detailError} onRetry={load} inline />
      )}

      {/* KPI (§6.2) — scoped to the selected import, and each card says so. */}
      <div className="kpi-row">
        <AsyncSection
          resource={importsRes}
          errorTitle="לא הצלחנו לטעון את נתוני האשראי"
          skeleton={<SkeletonCard />}
        >
          {() => (
            <>
              <SummaryCard
                label="חיוב קרוב"
                value={nextBilling ? formatCurrency(nextBilling.total) : "—"}
                // Without a loaded import we genuinely do not know — not ₪0 (§1.2).
                certainty={nextBilling ? "measured" : "unknown"}
                sub={nextBilling ? `${formatMonthKey(nextBilling.monthKey)} · בייבוא הנבחר` : "לא נטען ייבוא עם חיוב עתידי"}
              />
              <SummaryCard
                label="עסקאות ממתינות לאישור"
                value={String(pendingTransactions)}
                tone={pendingTransactions > 0 ? "warning" : "success"}
                sub={pendingTransactions > 0 ? `ב־${pendingImports.length} ייבואים` : "הכול מאושר ✓"}
              />
              <SummaryCard
                label="אשראי מתגלגל"
                value={formatCurrency(financingTotal)}
                sub="מימון פנימי — לא נספר בהוצאות"
              />
              <SummaryCard
                label="לא מסווגות באשראי"
                value={String(uncategorizedCount)}
                tone={uncategorizedCount > 0 ? "warning" : "success"}
                sub={uncategorizedCount > 0 ? "בייבוא הנבחר · לחיצה מסננת" : "בייבוא הנבחר"}
                onClick={uncategorizedCount > 0 ? () => setCatFilter("none") : undefined}
              />
            </>
          )}
        </AsyncSection>
      </div>

      <Card title={`אשראי לפי קטגוריה — ${formatMonthKey(monthKey)}`}>
        <AsyncSection
          resource={chartsRes}
          errorTitle="לא הצלחנו לטעון את פילוח האשראי"
          skeleton={<SkeletonChart />}
          isEmpty={(data) => data.creditByCategory.length === 0}
          emptyState={
            <EmptyState
              icon="💳"
              title="אין עסקאות אשראי בחודש הזה"
              hint="גררי לכאן קובץ אקסל מאתר חברת האשראי"
            />
          }
        >
          {(data) => <CategoryBarChart data={data.creditByCategory} />}
        </AsyncSection>
      </Card>

      <Card title="ייבואים">
        <AsyncSection
          resource={importsRes}
          errorTitle="לא הצלחנו לטעון את ייבואי האשראי"
          skeleton={<SkeletonRows rows={3} />}
        >
          {(rows) => (
            <Table
              columns={importColumns}
              rows={rows}
              rowKey={(row) => row.id}
              emptyState={
                <EmptyState
                  icon="💳"
                  title="אין עדיין ייבוא אשראי"
                  hint="גררי לכאן קובץ אקסל מאתר חברת האשראי"
                />
              }
            />
          )}
        </AsyncSection>
      </Card>

      {selected && selected.monthlyBreakdown && selected.monthlyBreakdown.length > 1 && (
        <Card title={`הקובץ מכסה ${selected.monthlyBreakdown.length} חודשי חיוב`}>
          <p className="settings-hint">
            לחיצה על חודש מסננת את העסקאות למטה · הכפתור פותח את החודש בדשבורד המלא
          </p>
          <div className="credit-month-cards">
            {selected.monthlyBreakdown.map((m) => (
              <div
                key={m.monthKey}
                className={`credit-month-card ${monthFilter === m.monthKey ? "credit-month-card-active" : ""}`}
              >
                <button
                  type="button"
                  className="credit-month-main"
                  onClick={() => setMonthFilter(monthFilter === m.monthKey ? null : m.monthKey)}
                >
                  <span className="credit-month-name">{formatMonthKey(m.monthKey)}</span>
                  <span className="credit-month-total mono">{formatCurrency(m.total)}</span>
                  <span className="text-muted">{m.count} עסקאות</span>
                </button>
                <button
                  type="button"
                  className="credit-month-link"
                  onClick={() => viewMonthOnDashboard(m.monthKey)}
                  title="פתיחת החודש בדשבורד"
                >
                  לדשבורד ←
                </button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {selected && (
        <Card
          title={
            monthFilter
              ? `עסקאות — ${formatMonthKey(monthFilter)}`
              : `כל העסקאות — ${selected.fileName}`
          }
          action={
            <span className="row-actions">
              {monthFilter && (
                <Button size="sm" variant="ghost" onClick={() => setMonthFilter(null)}>
                  הצגת כל החודשים ✕
                </Button>
              )}
              {selected.status !== "confirmed" ? (
                <Button size="sm" onClick={() => confirm(selected.id)}>אישור הייבוא ✓</Button>
              ) : (
                <span className="text-success">מאושר ✓</span>
              )}
            </span>
          }
        >
          <div className="filter-bar">
            <Input
              placeholder="חיפוש בית עסק…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="חיפוש לפי בית עסק"
            />
            <Select
              options={[
                { value: "", label: "כל הקטגוריות" },
                { value: "none", label: "לא מסווג" },
                ...expenseCategories.map((c) => ({ value: String(c.id), label: `${c.icon ?? ""} ${c.name}` })),
              ]}
              value={catFilter}
              onChange={(e) => setCatFilter(e.target.value)}
              aria-label="סינון לפי קטגוריה"
            />
            <Select
              options={[
                { value: "", label: "כל הסוגים" },
                { value: "regular", label: "רגילות" },
                { value: "standing_order", label: "הוראות קבע" },
                { value: "credit", label: "תשלומים" },
                { value: "refund", label: "זיכויים" },
                { value: "financing", label: "אשראי מתגלגל" },
              ]}
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              aria-label="סינון לפי סוג"
            />
            {(search || catFilter || typeFilter) && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setSearch("");
                  setCatFilter("");
                  setTypeFilter("");
                }}
              >
                ניקוי סינון ✕
              </Button>
            )}
          </div>
          <Table
            columns={txColumns}
            rows={filteredTransactions}
            rowKey={(row) => row.id}
            emptyState={
              /* Genuinely empty vs "the filter cut everything" need opposite actions (§4.5). */
              selectedTransactions.length === 0 ? (
                <EmptyState icon="💳" title="אין עסקאות בייבוא הזה" />
              ) : (
                <EmptyState
                  icon="🔍"
                  title="אין תוצאות למסננים הנוכחיים"
                  action={
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setSearch("");
                        setCatFilter("");
                        setTypeFilter("");
                        setMonthFilter(null);
                      }}
                    >
                      ניקוי מסננים
                    </Button>
                  }
                />
              )
            }
          />
        </Card>
      )}

      <Modal
        title="לסווג אוטומטית עסקאות דומות?"
        open={learn !== null}
        onClose={() => setLearn(null)}
      >
        {learn && (
          <>
            <p className="settings-hint">
              כל עסקה עתידית שתכיל את מילת המפתח תסווג אוטומטית ל־<strong>{learn.categoryName}</strong>. אפשר לערוך את מילת המפתח:
            </p>
            <Input
              label="מילת מפתח"
              value={learn.keyword}
              onChange={(e) => setLearn({ ...learn, keyword: e.target.value })}
            />
            <div className="modal-actions">
              <Button onClick={confirmLearn}>צור חוק וסווג</Button>
              <Button variant="ghost" onClick={() => setLearn(null)}>לא עכשיו</Button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}
