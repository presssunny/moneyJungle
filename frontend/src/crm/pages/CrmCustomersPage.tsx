import { useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { AsyncSection } from "../../components/common/AsyncSection";
import { Button } from "../../components/common/Button";
import { Card } from "../../components/common/Card";
import { EmptyState } from "../../components/common/EmptyState";
import { ErrorMessage } from "../../components/common/ErrorMessage";
import { Input } from "../../components/common/Input";
import { Modal } from "../../components/common/Modal";
import { PageShell } from "../../components/common/PageShell";
import { Select } from "../../components/common/Select";
import { SkeletonKpiRow, SkeletonRows } from "../../components/common/Skeleton";
import { Table, type Column } from "../../components/common/Table";
import { SummaryCard } from "../../components/dashboard/SummaryCard";
import { useAsync } from "../../hooks/useAsync";
import { apiErrorMessage } from "../../services/api";
import { currentUser } from "../../services/gate.service";
import { toast } from "../../services/toast";
import { formatCurrency, formatDate } from "../../utils/format";
import { createCrmCustomer, listCrmCustomers } from "../crm.service";
import type { CrmCustomerListItem, CrmRole } from "../crm.types";

type SortKey = "name" | "createdAt" | "totalIncome" | "totalExpense" | "recordCount" | "lastActivityAt";

const ROLE_LABELS: Record<CrmRole, string> = { ADMIN: "מנהל/ת", USER: "משתמש/ת", VIEWER: "צפייה בלבד" };
const ROLE_OPTIONS = (Object.keys(ROLE_LABELS) as CrmRole[]).map((value) => ({ value, label: ROLE_LABELS[value] }));

export default function CrmCustomersPage() {
  const isAdmin = currentUser()?.role === "ADMIN";
  const customers = useAsync(() => listCrmCustomers(), [], "לא הצלחנו לטעון את רשימת הלקוחות", ["crm"]);
  const [search, setSearch] = useState("");
  const [onlyActive, setOnlyActive] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<CrmRole>("USER");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // eslint-disable-next-line react-hooks/exhaustive-deps -- customers.data is
  // the stable identity; `?? []` only substitutes a fallback, never on its own.
  const rows = useMemo(() => customers.data ?? [], [customers.data]);

  const filtered = useMemo(() => {
    let list = rows;
    const q = search.trim();
    if (q) list = list.filter((c) => c.name.includes(q) || (c.email ?? "").includes(q));
    if (onlyActive) list = list.filter((c) => c.hasActivity);

    const dir = sortDir === "asc" ? 1 : -1;
    return [...list].sort((a, b) => {
      switch (sortKey) {
        case "name":
          return a.name.localeCompare(b.name, "he") * dir;
        case "createdAt":
          return (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) * dir;
        case "totalIncome":
          return (a.totalIncome - b.totalIncome) * dir;
        case "totalExpense":
          return (a.totalExpense - b.totalExpense) * dir;
        case "recordCount":
          return (a.recordCount - b.recordCount) * dir;
        case "lastActivityAt": {
          const at = a.lastActivityAt ? new Date(a.lastActivityAt).getTime() : 0;
          const bt = b.lastActivityAt ? new Date(b.lastActivityAt).getTime() : 0;
          return (at - bt) * dir;
        }
        default:
          return 0;
      }
    });
  }, [rows, search, onlyActive, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  function sortArrow(key: SortKey) {
    if (key !== sortKey) return "";
    return sortDir === "asc" ? " ▲" : " ▼";
  }

  async function submitCreate(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await createCrmCustomer({ name: name.trim(), email: email.trim(), password, role });
      setCreateOpen(false);
      setName("");
      setEmail("");
      setPassword("");
      setRole("USER");
      toast.success(`${name.trim()} נוסף/ה כלקוח/ה`);
      customers.reload();
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const withActivity = rows.filter((c) => c.hasActivity).length;
  const totalIncome = rows.reduce((sum, c) => sum + c.totalIncome, 0);
  const totalExpense = rows.reduce((sum, c) => sum + c.totalExpense, 0);
  const totalLoanBalance = rows.reduce((sum, c) => sum + c.activeLoanBalance, 0);

  const columns: Column<CrmCustomerListItem>[] = [
    {
      key: "name",
      header: "לקוח",
      render: (row) => (
        <Link to={`/crm/customers/${row.id}`} className="crm-customer-link">
          <span className="crm-avatar" aria-hidden>
            👤
          </span>
          <span>
            <strong>{row.name}</strong>
            <span className="text-muted crm-customer-id"> #{row.id}</span>
            {row.email && <div className="text-muted crm-customer-email">{row.email}</div>}
          </span>
        </Link>
      ),
    },
    {
      key: "role",
      header: "תפקיד",
      render: (row) => <span className="crm-pill crm-pill-role">{ROLE_LABELS[row.role]}</span>,
    },
    {
      key: "status",
      header: "סטטוס",
      render: (row) =>
        row.status === "active" ? (
          <span className="crm-pill crm-pill-active">פעיל</span>
        ) : (
          <span className="crm-pill crm-pill-danger">מושבת</span>
        ),
    },
    {
      key: "activity",
      header: "נתונים",
      render: (row) =>
        row.hasActivity ? (
          <span className="crm-pill crm-pill-active">{row.recordCount} רשומות</span>
        ) : (
          <span className="crm-pill crm-pill-empty">אין נתונים</span>
        ),
    },
    {
      key: "income",
      header: "הכנסות",
      align: "left",
      render: (row) => <span className="mono">{formatCurrency(row.totalIncome)}</span>,
    },
    {
      key: "expense",
      header: "הוצאות",
      align: "left",
      render: (row) => <span className="mono">{formatCurrency(row.totalExpense)}</span>,
    },
    {
      key: "net",
      header: "תזרים נטו",
      align: "left",
      render: (row) => (
        <span className={`mono tone-${row.netCashflow >= 0 ? "success" : "danger"}`}>
          {formatCurrency(row.netCashflow, { sign: true })}
        </span>
      ),
    },
    {
      key: "loans",
      header: "יתרת הלוואות",
      align: "left",
      render: (row) => <span className="mono">{formatCurrency(row.activeLoanBalance)}</span>,
    },
    { key: "created", header: "נוצר", render: (row) => formatDate(row.createdAt) },
    {
      key: "lastActivity",
      header: "פעילות אחרונה",
      render: (row) => (row.lastActivityAt ? formatDate(row.lastActivityAt) : "—"),
    },
  ];

  return (
    <PageShell
      toolbar={
        <div className="crm-toolbar">
          <div className="crm-toolbar-filters">
            <Input
              placeholder="חיפוש לפי שם או אימייל…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="חיפוש לקוח"
            />
            <label className="crm-checkbox">
              <input type="checkbox" checked={onlyActive} onChange={(e) => setOnlyActive(e.target.checked)} />
              רק עם נתונים משויכים
            </label>
          </div>
          {/* Backend-enforced too (requireRole("ADMIN") on POST /crm/customers) —
              hiding it for VIEWER here is just UX, not the real authorization. */}
          {isAdmin && <Button onClick={() => setCreateOpen(true)}>+ לקוח חדש</Button>}
        </div>
      }
      summary={
        <AsyncSection
          resource={customers}
          errorTitle="לא הצלחנו לטעון את סיכום הלקוחות"
          skeleton={<SkeletonKpiRow count={4} label="טוען סיכום" />}
        >
          {() => (
            <div className="kpi-row">
              <SummaryCard label="סה״כ לקוחות" value={String(rows.length)} icon="👥" />
              <SummaryCard
                label="עם נתונים משויכים"
                value={String(withActivity)}
                icon="🔗"
                sub={withActivity < rows.length ? `${rows.length - withActivity} ללא נתונים` : undefined}
              />
              <SummaryCard label="סה״כ הכנסות" value={formatCurrency(totalIncome)} icon="💰" />
              <SummaryCard
                label="סה״כ הוצאות"
                value={formatCurrency(totalExpense)}
                icon="💸"
                tone={totalExpense > totalIncome ? "danger" : "default"}
              />
              <SummaryCard label="יתרת הלוואות פעילות" value={formatCurrency(totalLoanBalance)} icon="📉" />
            </div>
          )}
        </AsyncSection>
      }
    >
      <Card title={`רשימת לקוחות (${filtered.length})`}>
        <div className="crm-sort-row">
          <span className="text-muted">מיון:</span>
          {(
            [
              ["name", "שם"],
              ["createdAt", "תאריך יצירה"],
              ["totalIncome", "הכנסות"],
              ["totalExpense", "הוצאות"],
              ["recordCount", "כמות רשומות"],
              ["lastActivityAt", "פעילות אחרונה"],
            ] as [SortKey, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={`crm-sort-btn ${sortKey === key ? "crm-sort-btn-active" : ""}`}
              onClick={() => toggleSort(key)}
            >
              {label}
              {sortArrow(key)}
            </button>
          ))}
        </div>

        <AsyncSection
          resource={customers}
          errorTitle="לא הצלחנו לטעון את רשימת הלקוחות"
          skeleton={<SkeletonRows rows={4} />}
        >
          {() => (
            <Table
              columns={columns}
              rows={filtered}
              rowKey={(row) => row.id}
              pageSize={20}
              emptyState={
                <EmptyState
                  icon="🗂️"
                  title={rows.length === 0 ? "אין עדיין לקוחות במערכת" : "לא נמצאו לקוחות תואמים"}
                  hint={rows.length === 0 ? "צרי לקוח חדש כדי להתחיל" : "נסי לשנות את החיפוש או הסינון"}
                />
              }
            />
          )}
        </AsyncSection>
      </Card>

      <Modal title="לקוח חדש" open={createOpen} onClose={() => setCreateOpen(false)}>
        <form onSubmit={submitCreate}>
          {error && <ErrorMessage message={error} />}
          <Input label="שם" required value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          <Input
            label="אימייל"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Input
            label="סיסמה זמנית"
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <Select label="תפקיד" options={ROLE_OPTIONS} value={role} onChange={(e) => setRole(e.target.value as CrmRole)} />
          <p className="text-muted crm-hint">
            הלקוח יוכל להתחבר לאפליקציה עם האימייל והסיסמה שהוגדרו כאן.
          </p>
          <div className="modal-actions">
            <Button type="submit" disabled={busy}>
              הוספה
            </Button>
            <Button type="button" variant="ghost" onClick={() => setCreateOpen(false)}>
              ביטול
            </Button>
          </div>
        </form>
      </Modal>
    </PageShell>
  );
}
