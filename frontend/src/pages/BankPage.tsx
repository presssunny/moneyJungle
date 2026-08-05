import { useMemo, useState, type FormEvent } from "react";
import { AsyncSection } from "../components/common/AsyncSection";
import { PageShell } from "../components/common/PageShell";
import { Button } from "../components/common/Button";
import { Card } from "../components/common/Card";
import { useConfirm } from "../components/common/ConfirmDialog";
import { DropZone } from "../components/common/DropZone";
import { EmptyState } from "../components/common/EmptyState";
import { ErrorMessage } from "../components/common/ErrorMessage";
import { Input } from "../components/common/Input";
import { Modal } from "../components/common/Modal";
import { Select } from "../components/common/Select";
import { SkeletonCard, SkeletonRows } from "../components/common/Skeleton";
import { Table, type Column } from "../components/common/Table";
import { SummaryCard } from "../components/dashboard/SummaryCard";
import { useMonth } from "../context/MonthContext";
import { useAsync } from "../hooks/useAsync";
import { useLookups } from "../hooks/useLookups";
import { apiErrorMessage } from "../services/api";
import {
  createBankAccount,
  createBankTransaction,
  deleteBankAccount,
  deleteBankTransaction,
  importBankStatement,
  listBankAccounts,
  listBankTransactions,
  setBankAnchor,
} from "../services/planning.service";
import type { BankAccount, BankTransaction } from "../types/models";
import { formatCurrency, formatDate, formatMonthKey } from "../utils/format";

const TX_TYPES = [
  { value: "deposit", label: "הפקדה" },
  { value: "withdrawal", label: "משיכה" },
  { value: "transfer", label: "העברה" },
  { value: "fee", label: "עמלה" },
  { value: "other", label: "אחר" },
];

/**
 * טאב־משנה "בנק" (IA §6.3). The KPI row describes the selected account inside
 * the globally selected month; the balance-trend line chart is listed as
 * optional in §6.3 and is deferred rather than blocking this stage.
 */
export default function BankPage() {
  const confirm = useConfirm();
  const { monthKey } = useMonth();
  const { expenseCategories } = useLookups();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const [accountForm, setAccountForm] = useState({ bankName: "", accountName: "", initialBalance: 0 });
  const [txOpen, setTxOpen] = useState(false);
  const [anchorForm, setAnchorForm] = useState({ balance: "", asOf: new Date().toISOString().slice(0, 10) });
  const [txForm, setTxForm] = useState({
    transactionDate: new Date().toISOString().slice(0, 10),
    description: "",
    amount: 0,
    type: "withdrawal",
    categoryId: null as number | null,
  });
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [importMsg, setImportMsg] = useState("");
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [txSearch, setTxSearch] = useState("");
  const [txTypeFilter, setTxTypeFilter] = useState("");

  const [reloadKey, setReloadKey] = useState(0);
  const load = () => setReloadKey((k) => k + 1);

  const accountsRes = useAsync(
    async () => {
      const data = await listBankAccounts();
      // Preselect the first account so the page is never an empty shell.
      setSelectedId((current) => (current === null && data.length > 0 ? data[0].id : current));
      return data;
    },
    [reloadKey],
    "לא הצלחנו לטעון את חשבונות הבנק"
  );
  const accounts = accountsRes.data;

  const txRes = useAsync(
    () => (selectedId === null ? Promise.resolve<BankTransaction[]>([]) : listBankTransactions(selectedId)),
    [selectedId, reloadKey],
    "לא הצלחנו לטעון את התנועות"
  );

  // Deposits / withdrawals inside the globally selected month. The bank endpoint
  // has no month parameter (IA §9.2), so the window is applied here on rows the
  // server already returned — no server-side figure is recomputed.
  const monthStats = useMemo(() => {
    const rows = (txRes.data ?? []).filter((tx) => tx.transactionDate.slice(0, 7) === monthKey);
    let deposits = 0;
    let withdrawals = 0;
    for (const tx of rows) {
      if (tx.type === "deposit") deposits += Number(tx.amount);
      else withdrawals += Number(tx.amount);
    }
    return {
      rows,
      deposits,
      withdrawals,
      uncategorized: rows.filter((tx) => tx.categoryId === null && tx.type !== "deposit").length,
    };
  }, [txRes.data, monthKey]);

  async function submitAccount(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      const account = await createBankAccount(accountForm);
      setAccountOpen(false);
      setAccountForm({ bankName: "", accountName: "", initialBalance: 0 });
      setSelectedId(account.id);
      // If the account was created off a dropped statement, import it now.
      if (pendingFile) {
        const file = pendingFile;
        setPendingFile(null);
        await importInto(account.id, file);
      }
      load();
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  }

  async function submitAnchor(e: FormEvent) {
    e.preventDefault();
    if (selectedId === null) return;
    setError("");
    try {
      await setBankAnchor(selectedId, {
        balance: Number(anchorForm.balance),
        asOf: anchorForm.asOf,
      });
      setAnchorForm({ balance: "", asOf: new Date().toISOString().slice(0, 10) });
      load();
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  }

  async function submitTx(e: FormEvent) {
    e.preventDefault();
    if (selectedId === null) return;
    setError("");
    try {
      await createBankTransaction(selectedId, { ...txForm, description: txForm.description || null });
      setTxOpen(false);
      setTxForm({ ...txForm, description: "", amount: 0 });
      load();
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  }

  async function importInto(accountId: number, file: File) {
    setError("");
    setImportMsg("");
    setUploading(true);
    try {
      const result = await importBankStatement(accountId, file);
      const parts = [`נוספו ${result.imported} תנועות`];
      if (result.deposits > 0 || result.withdrawals > 0) {
        parts.push(`(${result.deposits} הכנסות · ${result.withdrawals} הוצאות)`);
      }
      if (result.skippedDuplicates > 0) parts.push(`· ${result.skippedDuplicates} כפילויות דולגו`);
      setImportMsg(parts.join(" "));
      load(); // reloads both the balances and the transaction list
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setUploading(false);
    }
  }

  /** A dropped statement imports into the selected account, or — if there are no
   *  accounts yet — opens "new account" pre-filled and imports once it's created. */
  function handleDroppedFile(file: File) {
    if (selectedId !== null) {
      importInto(selectedId, file);
      return;
    }
    setPendingFile(file);
    setAccountForm({ bankName: "", accountName: "עו״ש", initialBalance: 0 });
    setError("");
    setImportMsg("");
    setAccountOpen(true);
  }

  function removeAccount(account: BankAccount) {
    confirm.ask(
      {
        title: "מחיקת חשבון בנק",
        message: (
          <>
            החשבון <strong>{account.accountName}</strong> יימחק.
            <span className="confirm-consequence">
              כל התנועות שיובאו אליו יימחקו יחד איתו, והסכומים שנגזרו מהן ייעלמו מהדשבורד.
              הפעולה אינה הפיכה — אפשר יהיה לייבא את הדוחות מחדש.
            </span>
          </>
        ),
        confirmLabel: "מחיקת החשבון",
        tone: "danger",
      },
      async () => {
        await deleteBankAccount(account.id);
        setSelectedId(null);
        load();
      }
    );
  }

  function removeTx(tx: BankTransaction) {
    confirm.ask(
      {
        title: "מחיקת תנועה",
        message: (
          <>
            התנועה <strong>{tx.description || "ללא תיאור"}</strong> תימחק מהחשבון.
            <span className="confirm-consequence">היתרה והסכומים החודשיים יחושבו מחדש בלעדיה.</span>
          </>
        ),
        confirmLabel: "מחיקה",
        tone: "danger",
      },
      async () => {
        await deleteBankTransaction(tx.id);
        load();
      }
    );
  }

  const txColumns: Column<BankTransaction>[] = [
    { key: "date", header: "תאריך", render: (row) => formatDate(row.transactionDate) },
    { key: "desc", header: "תיאור", render: (row) => row.description || "—" },
    { key: "type", header: "סוג", render: (row) => TX_TYPES.find((t) => t.value === row.type)?.label ?? row.type },
    {
      key: "amount",
      header: "סכום",
      align: "left",
      render: (row) => (
        <span className={`mono ${row.type === "deposit" ? "text-success" : "text-danger"}`}>
          {row.type === "deposit" ? "+" : "-"}{formatCurrency(Number(row.amount))}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "left",
      render: (row) => (
        <Button size="sm" variant="ghost" onClick={() => removeTx(row)} aria-label="מחיקה">
          🗑️
        </Button>
      ),
    },
  ];

  const selected = (accounts ?? []).find((a) => a.id === selectedId) ?? null;

  const searchLower = txSearch.trim().toLowerCase();
  const visibleTx = monthStats.rows.filter((tx) => {
    if (txTypeFilter && tx.type !== txTypeFilter) return false;
    if (searchLower && !(tx.description ?? "").toLowerCase().includes(searchLower)) return false;
    return true;
  });
  const txFiltersActive = txSearch.trim() !== "" || txTypeFilter !== "";

  return (
    <PageShell
      toolbar={
        <>
          <Button onClick={() => setAccountOpen(true)}>+ חשבון בנק</Button>
          {selected && <Button variant="outline" onClick={() => setTxOpen(true)}>+ תנועה</Button>}
        </>
      }
    >

      {/* KPI (§6.3) — the selected account, inside the selected month. */}
      <div className="kpi-row">
        <AsyncSection
          resource={accountsRes}
          errorTitle="לא הצלחנו לטעון את חשבונות הבנק"
          skeleton={<SkeletonCard />}
        >
          {() => (
            <SummaryCard
              label="יתרה בחשבון הנבחר"
              value={selected ? formatCurrency(Number(selected.currentBalance)) : "—"}
              /* A balance nobody confirmed is an estimate, and is marked as one. */
              certainty={
                !selected ? "unknown" : selected.balanceDetail?.basis === "statement" ? "measured" : "scenario"
              }
              tone={selected && Number(selected.currentBalance) < 0 ? "danger" : "success"}
              sub={selected ? `${selected.bankName} · ${selected.accountName}` : "לא נבחר חשבון"}
              footnote={selected?.balanceDetail?.explanation}
            />
          )}
        </AsyncSection>
        <AsyncSection resource={txRes} errorTitle="לא הצלחנו לטעון את התנועות" skeleton={<SkeletonCard />}>
          {() => (
            <>
              <SummaryCard
                label="הפקדות בחודש"
                value={formatCurrency(monthStats.deposits)}
                tone="success"
                sub={formatMonthKey(monthKey)}
              />
              <SummaryCard
                label="משיכות בחודש"
                value={formatCurrency(monthStats.withdrawals)}
                tone="danger"
                sub={formatMonthKey(monthKey)}
              />
              <SummaryCard
                label="תנועות לא מסווגות"
                value={String(monthStats.uncategorized)}
                tone={monthStats.uncategorized > 0 ? "warning" : "success"}
                sub={monthStats.uncategorized > 0 ? "מתוך משיכות החודש" : "הכול מסווג ✓"}
              />
            </>
          )}
        </AsyncSection>
      </div>

      {/* A balance we could not tie to anything the bank stated is called out,
          with the one action that fixes it. */}
      {selected?.balanceDetail?.basis === "accumulated" && (
        <Card title="היתרה לא מאומתת">
          <p className="settings-hint">
            אף דף חשבון שיובא לא כלל עמודת יתרה, ולכן היתרה מחושבת כסכום כל התנועות — היא עלולה
            להיות שגויה. אפשר לתקן בשתי דרכים: לייבא דף חשבון שכולל עמודת יתרה, או להזין כאן את
            היתרה שמופיעה בבנק ואת התאריך שאליו היא נכונה. מאותו רגע היתרה תיגזר מהמספר הזה
            ומהתנועות שאחריו בלבד.
          </p>
          <form className="form-inline" onSubmit={submitAnchor}>
            <Input
              label="יתרה בבנק (₪)"
              type="number"
              step="0.01"
              required
              value={anchorForm.balance}
              onChange={(e) => setAnchorForm({ ...anchorForm, balance: e.target.value })}
            />
            <Input
              label="נכון לתאריך"
              type="date"
              required
              value={anchorForm.asOf}
              onChange={(e) => setAnchorForm({ ...anchorForm, asOf: e.target.value })}
            />
            <Button type="submit">עיגון היתרה</Button>
          </form>
        </Card>
      )}

      <Card title={selected ? `ייבוא דף חשבון — ${selected.accountName}` : "ייבוא דף חשבון (עו״ש)"}>
        {error && <ErrorMessage message={error} />}
        <DropZone
          onFile={handleDroppedFile}
          busy={uploading}
          accept=".xlsx,.xls,.csv,.pdf"
          icon="🏦"
          title="גררי לכאן דף חשבון (עו״ש) — Excel או PDF — או לחצי לבחירה"
          hint={
            selected
              ? `הכנסות (זכות) והוצאות (חובה) ייקלטו לחשבון "${selected.accountName}" — ההוצאות יסווגו לפי חוקים, וכפילויות ידולגו. ב-PDF הסיווג להכנסה/הוצאה נגזר מהיתרה המתגלגלת — כדאי לעבור על התנועות אחרי הייבוא`
              : "הכנסות (זכות) והוצאות (חובה) ייקלטו אוטומטית מ-Excel או PDF. אין עדיין חשבון? גררי קובץ ותנחי ליצור אחד — הייבוא יתחיל מיד אחריו"
          }
        />
        {importMsg && <div className="info-banner" style={{ marginTop: 12 }}>{importMsg}</div>}
      </Card>

      <AsyncSection
        resource={accountsRes}
        errorTitle="לא הצלחנו לטעון את חשבונות הבנק"
        skeleton={<SkeletonRows rows={2} />}
        isEmpty={(data) => data.length === 0}
        emptyState={
          <Card>
            <EmptyState
              icon="🏦"
              title="אין חשבונות בנק"
              hint="גררי דף חשבון (עו״ש) — Excel או PDF — ונפתח חשבון אוטומטית"
            />
          </Card>
        }
      >
        {(accountList) => (
          <div className="bank-accounts-row">
            {accountList.map((account) => (
            <button
              key={account.id}
              type="button"
              className={`bank-account-card ${account.id === selectedId ? "bank-account-active" : ""}`}
              onClick={() => setSelectedId(account.id)}
            >
              <span className="bank-account-name">🏦 {account.bankName} · {account.accountName}</span>
              <span className={`bank-account-balance mono ${Number(account.currentBalance) < 0 ? "text-danger" : "text-success"}`}>
                {formatCurrency(Number(account.currentBalance))}
              </span>
              <span className="text-muted">{account._count?.transactions ?? 0} תנועות</span>
              <span
                className="bank-account-delete"
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  removeAccount(account);
                }}
                onKeyDown={(e) => e.key === "Enter" && removeAccount(account)}
              >
                ✕
                </span>
              </button>
            ))}
          </div>
        )}
      </AsyncSection>

      {selected && (
        <Card title={`תנועות — ${selected.accountName} · ${formatMonthKey(monthKey)}`}>
          <div className="filter-bar">
            <Input
              placeholder="חיפוש בתיאור…"
              value={txSearch}
              onChange={(e) => setTxSearch(e.target.value)}
              aria-label="חיפוש בתנועות"
            />
            <Select
              options={[{ value: "", label: "כל סוגי התנועות" }, ...TX_TYPES]}
              value={txTypeFilter}
              onChange={(e) => setTxTypeFilter(e.target.value)}
              aria-label="סינון לפי סוג תנועה"
            />
            {txFiltersActive && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setTxSearch("");
                  setTxTypeFilter("");
                }}
              >
                ניקוי סינון ✕
              </Button>
            )}
          </div>
          <AsyncSection
            resource={txRes}
            errorTitle="לא הצלחנו לטעון את התנועות"
            skeleton={<SkeletonRows rows={5} />}
          >
            {() => (
              <Table
                columns={txColumns}
                rows={visibleTx}
                rowKey={(row) => row.id}
                emptyState={
                  monthStats.rows.length > 0 ? (
                    <EmptyState
                      icon="🔍"
                      title="אין תוצאות למסננים הנוכחיים"
                      action={
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setTxSearch("");
                            setTxTypeFilter("");
                          }}
                        >
                          ניקוי מסננים
                        </Button>
                      }
                    />
                  ) : (
                    <EmptyState
                      icon="🧾"
                      title={`אין תנועות ב${formatMonthKey(monthKey)}`}
                      hint="בחרי חודש אחר, או ייבאי דף חשבון"
                    />
                  )
                }
              />
            )}
          </AsyncSection>
        </Card>
      )}

      <Modal title="חשבון בנק חדש" open={accountOpen} onClose={() => setAccountOpen(false)}>
        <form onSubmit={submitAccount}>
          {error && <ErrorMessage message={error} />}
          <div className="form-row">
            <Input label="בנק" required value={accountForm.bankName} onChange={(e) => setAccountForm({ ...accountForm, bankName: e.target.value })} />
            <Input label="שם החשבון" required value={accountForm.accountName} onChange={(e) => setAccountForm({ ...accountForm, accountName: e.target.value })} />
          </div>
          <Input
            label="יתרה נוכחית (₪)"
            type="number"
            step="0.01"
            value={accountForm.initialBalance || ""}
            onChange={(e) => setAccountForm({ ...accountForm, initialBalance: Number(e.target.value) })}
          />
          <div className="modal-actions">
            <Button type="submit">הוספה</Button>
            <Button type="button" variant="ghost" onClick={() => setAccountOpen(false)}>ביטול</Button>
          </div>
        </form>
      </Modal>

      <Modal title="תנועה חדשה" open={txOpen} onClose={() => setTxOpen(false)}>
        <form onSubmit={submitTx}>
          {error && <ErrorMessage message={error} />}
          <div className="form-row">
            <Select label="סוג" options={TX_TYPES} value={txForm.type} onChange={(e) => setTxForm({ ...txForm, type: e.target.value })} />
            <Input
              label="סכום (₪)"
              type="number"
              step="0.01"
              min="0.01"
              required
              value={txForm.amount || ""}
              onChange={(e) => setTxForm({ ...txForm, amount: Number(e.target.value) })}
            />
          </div>
          <div className="form-row">
            <Input label="תאריך" type="date" required value={txForm.transactionDate} onChange={(e) => setTxForm({ ...txForm, transactionDate: e.target.value })} />
            <Select
              label="קטגוריה (רשות)"
              options={expenseCategories.map((c) => ({ value: c.id, label: `${c.icon ?? ""} ${c.name}` }))}
              placeholder="ללא"
              value={txForm.categoryId ?? ""}
              onChange={(e) => setTxForm({ ...txForm, categoryId: e.target.value ? Number(e.target.value) : null })}
            />
          </div>
          <Input label="תיאור" value={txForm.description} onChange={(e) => setTxForm({ ...txForm, description: e.target.value })} />
          <div className="modal-actions">
            <Button type="submit">הוספה</Button>
            <Button type="button" variant="ghost" onClick={() => setTxOpen(false)}>ביטול</Button>
          </div>
        </form>
      </Modal>

      {confirm.dialog}
    </PageShell>
  );
}
