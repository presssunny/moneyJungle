import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../components/common/Button";
import { Card } from "../components/common/Card";
import { EmptyState } from "../components/common/EmptyState";
import { Input } from "../components/common/Input";
import { Loading } from "../components/common/Loading";
import { Modal } from "../components/common/Modal";
import { Select } from "../components/common/Select";
import { Table, type Column } from "../components/common/Table";
import { useMonth } from "../context/MonthContext";
import { useLookups } from "../hooks/useLookups";
import { apiErrorMessage } from "../services/api";
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
import { formatCurrency, formatDate, formatMonthKey } from "../utils/format";

export default function CreditPage() {
  const { monthKey, setMonthKey } = useMonth();
  const navigate = useNavigate();
  const { expenseCategories } = useLookups();
  const [imports, setImports] = useState<CreditImport[] | null>(null);
  const [selected, setSelected] = useState<CreditImportDetail | null>(null);
  const [monthFilter, setMonthFilter] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState<string>("");
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [learn, setLearn] = useState<{ keyword: string; categoryId: number; categoryName: string } | null>(null);
  const [message, setMessage] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function viewMonthOnDashboard(monthKey: string) {
    setMonthKey(monthKey);
    navigate("/");
  }

  const load = useCallback(() => {
    listCreditImports()
      .then((list) => {
        setImports(list);
        // Auto-open the most recent import so its month-by-month split is
        // visible right away instead of hidden behind a click.
        setSelected((current) => {
          if (current || list.length === 0) return current;
          getCreditImport(list[0].id).then(setSelected).catch(() => {});
          return current;
        });
      })
      .catch(() => setImports([]));
  }, []);

  useEffect(load, [load]);

  async function onUpload(file: File) {
    setUploading(true);
    setMessage("");
    try {
      const detail = await uploadCreditImport(file, monthKey);
      setMonthFilter(null);
      setSelected(detail);
      const months = detail.monthlyBreakdown?.length ?? 1;
      const base =
        months > 1
          ? `נקלטו ${detail.totalTransactions} עסקאות ופוצלו ל־${months} חודשי חיוב — בדקי סיווג ואשרי`
          : `נקלטו ${detail.totalTransactions} עסקאות — בדקי סיווג ואשרי`;
      setMessage(
        detail.possibleDuplicate
          ? `⚠️ נראה שהקובץ הזה כבר יובא בעבר — ייתכן כפילות. ${base}`
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

  if (!imports) return <Loading />;

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
          <Button size="sm" variant="ghost" onClick={() => openImport(row)}>👁️</Button>
          <Button size="sm" variant="ghost" onClick={() => removeImport(row)}>🗑️</Button>
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

      <Card title="ייבואים">
        <Table
          columns={importColumns}
          rows={imports}
          rowKey={(row) => row.id}
          emptyState={<EmptyState icon="💳" title="אין ייבואי אשראי" hint="ייבאי קובץ אקסל של פירוט חיובי האשראי" />}
        />
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
            emptyState={<EmptyState icon="🔍" title="אין עסקאות שמתאימות לסינון" hint="נסי לנקות חלק מהמסננים" />}
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
