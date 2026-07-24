import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Button } from "../components/common/Button";
import { Card } from "../components/common/Card";
import { DropZone } from "../components/common/DropZone";
import { EmptyState } from "../components/common/EmptyState";
import { ErrorMessage } from "../components/common/ErrorMessage";
import { Input } from "../components/common/Input";
import { Loading } from "../components/common/Loading";
import { Modal } from "../components/common/Modal";
import { Select } from "../components/common/Select";
import { Table, type Column } from "../components/common/Table";
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
} from "../services/planning.service";
import type { BankAccount, BankTransaction } from "../types/models";
import { formatCurrency, formatDate } from "../utils/format";

const TX_TYPES = [
  { value: "deposit", label: "הפקדה" },
  { value: "withdrawal", label: "משיכה" },
  { value: "transfer", label: "העברה" },
  { value: "fee", label: "עמלה" },
  { value: "other", label: "אחר" },
];

export default function BankPage() {
  const { expenseCategories } = useLookups();
  const [accounts, setAccounts] = useState<BankAccount[] | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [transactions, setTransactions] = useState<BankTransaction[] | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const [accountForm, setAccountForm] = useState({ bankName: "", accountName: "", initialBalance: 0 });
  const [txOpen, setTxOpen] = useState(false);
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

  const load = useCallback(() => {
    listBankAccounts()
      .then((data) => {
        setAccounts(data);
        if (data.length > 0 && selectedId === null) setSelectedId(data[0].id);
      })
      .catch(() => setAccounts([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  useEffect(load, [load]);

  useEffect(() => {
    if (selectedId === null) {
      setTransactions(null);
      return;
    }
    listBankTransactions(selectedId).then(setTransactions).catch(() => setTransactions([]));
  }, [selectedId, accounts]);

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
      listBankTransactions(accountId).then(setTransactions).catch(() => {});
      load(); // balance changed
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

  async function removeAccount(account: BankAccount) {
    if (!window.confirm(`למחוק את החשבון "${account.accountName}" על כל התנועות שבו?`)) return;
    await deleteBankAccount(account.id);
    setSelectedId(null);
    load();
  }

  async function removeTx(tx: BankTransaction) {
    if (!window.confirm("למחוק את התנועה?")) return;
    await deleteBankTransaction(tx.id);
    load();
  }

  if (!accounts) return <Loading />;

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
      render: (row) => <Button size="sm" variant="ghost" onClick={() => removeTx(row)}>🗑️</Button>,
    },
  ];

  const selected = accounts.find((a) => a.id === selectedId) ?? null;

  return (
    <>
      <div className="page-toolbar">
        <Button onClick={() => setAccountOpen(true)}>+ חשבון בנק</Button>
        {selected && <Button variant="outline" onClick={() => setTxOpen(true)}>+ תנועה</Button>}
      </div>

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

      {accounts.length === 0 ? (
        <Card>
          <EmptyState icon="🏦" title="אין חשבונות בנק" hint="הוסיפי חשבון כדי לעקוב אחרי היתרה והתנועות" />
        </Card>
      ) : (
        <div className="bank-accounts-row">
          {accounts.map((account) => (
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

      {selected && transactions && (
        <Card title={`תנועות — ${selected.accountName}`}>
          <Table
            columns={txColumns}
            rows={transactions}
            rowKey={(row) => row.id}
            emptyState={<EmptyState icon="🧾" title="אין תנועות בחשבון" />}
          />
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
    </>
  );
}
