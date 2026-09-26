import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { Button } from "../../components/common/Button";
import { Card } from "../../components/common/Card";
import { useConfirm } from "../../hooks/useConfirm";
import { EmptyState } from "../../components/common/EmptyState";
import { ErrorMessage } from "../../components/common/ErrorMessage";
import { Input } from "../../components/common/Input";
import { Loading } from "../../components/common/Loading";
import { Modal } from "../../components/common/Modal";
import { PageShell } from "../../components/common/PageShell";
import { Select } from "../../components/common/Select";
import { Table, type Column } from "../../components/common/Table";
import { SummaryCard } from "../../components/dashboard/SummaryCard";
import { useAsync } from "../../hooks/useAsync";
import { apiErrorMessage } from "../../services/api";
import { currentUser } from "../../services/gate.service";
import { toast } from "../../services/toast";
import { formatCurrency, formatDate } from "../../utils/format";
import { getCrmCustomer, updateCrmCustomer } from "../crm.service";
import type {
  CrmAlert,
  CrmBankAccount,
  CrmBankTransaction,
  CrmBudget,
  CrmCreditImport,
  CrmDocument,
  CrmExpense,
  CrmFamilyMember,
  CrmIncome,
  CrmLoan,
  CrmPaymentMethod,
  CrmRecurringPayment,
  CrmReminder,
  CrmRole,
  CrmSavingsGoal,
  CrmSubscription,
} from "../crm.types";

const LOAN_STATUS_LABEL: Record<string, string> = { active: "פעילה", finished: "הסתיימה", overdue: "בפיגור" };
const SUB_STATUS_LABEL: Record<string, string> = { active: "פעילה", inactive: "לא פעילה" };
const SEVERITY_LABEL: Record<string, string> = { info: "מידע", warning: "אזהרה", critical: "קריטי" };
const ROLE_LABELS: Record<CrmRole, string> = { ADMIN: "מנהל/ת", USER: "משתמש/ת", VIEWER: "צפייה בלבד" };
const ROLE_OPTIONS = (Object.keys(ROLE_LABELS) as CrmRole[]).map((value) => ({ value, label: ROLE_LABELS[value] }));
const RELATION_LABELS: Record<string, string> = { spouse: "בן/בת זוג", child: "ילד/ה", parent: "הורה", other: "אחר" };

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <Card title={`${title} (${count})`} className="crm-section">
      {children}
    </Card>
  );
}

export default function CrmCustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const customerId = Number(id);
  const isAdmin = currentUser()?.role === "ADMIN";
  const isSelf = currentUser()?.id === customerId;
  const detail = useAsync(() => getCrmCustomer(customerId), [customerId], "לא הצלחנו לטעון את כרטיס הלקוח", ["crm"]);
  const confirm = useConfirm();

  const [editOpen, setEditOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<CrmRole>("USER");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function openEdit(currentName: string, currentEmail: string | null, currentRole: CrmRole) {
    setName(currentName);
    setEmail(currentEmail ?? "");
    setRole(currentRole);
    setPassword("");
    setError("");
    setEditOpen(true);
  }

  async function submitEdit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await updateCrmCustomer(customerId, {
        name: name.trim(),
        email: email.trim(),
        role,
        ...(password ? { password } : {}),
      });
      setEditOpen(false);
      detail.reload();
      toast.success("הפרטים עודכנו");
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  // Deliberately no delete route from the CRM — every domain table cascades
  // from the user relation, so deleting an account would silently take its
  // entire financial history with it. Deactivating blocks login and is
  // reversible; that is the supported way to "remove" someone here.
  function askToggleStatus(customerName: string, active: boolean) {
    confirm.ask(
      {
        title: active ? `השבתת ${customerName}` : `הפעלת ${customerName}`,
        message: active ? (
          <>
            <strong>{customerName}</strong> לא יוכל/תוכל להתחבר לאפליקציה עד שהחשבון יופעל מחדש.
            <span className="confirm-consequence">הנתונים הכספיים נשארים במערכת ואינם נמחקים.</span>
          </>
        ) : (
          <>
            <strong>{customerName}</strong> יוכל/תוכל להתחבר לאפליקציה שוב.
          </>
        ),
        confirmLabel: active ? "השבתה" : "הפעלה",
        tone: active ? "danger" : "default",
      },
      async () => {
        await updateCrmCustomer(customerId, { status: active ? "inactive" : "active" });
        detail.reload();
        toast.success(active ? `${customerName} הושבת/ה` : `${customerName} הופעל/ה`);
      }
    );
  }

  if (detail.loading && !detail.data) return <Loading label="טוען כרטיס לקוח…" />;
  if (detail.error && !detail.data) {
    return (
      <PageShell>
        <ErrorMessage message={detail.error} />
        <Button variant="ghost" onClick={detail.reload}>
          נסי שוב
        </Button>
      </PageShell>
    );
  }
  const data = detail.data;
  if (!data) return null;

  const familyColumns: Column<CrmFamilyMember>[] = [
    { key: "name", header: "שם", render: (r) => r.name },
    { key: "relation", header: "קשר", render: (r) => (r.relation ? RELATION_LABELS[r.relation] ?? r.relation : "—") },
    { key: "created", header: "נוצר", render: (r) => formatDate(r.createdAt) },
  ];

  const incomeColumns: Column<CrmIncome>[] = [
    { key: "date", header: "תאריך", render: (r) => formatDate(r.incomeDate) },
    { key: "type", header: "סוג", render: (r) => r.type },
    { key: "desc", header: "תיאור", render: (r) => r.description ?? "—" },
    { key: "recurring", header: "קבועה", render: (r) => (r.isRecurring ? "כן" : "לא") },
    { key: "amount", header: "סכום", align: "left", render: (r) => <span className="mono">{formatCurrency(r.amount)}</span> },
  ];

  const expenseColumns: Column<CrmExpense>[] = [
    { key: "date", header: "תאריך", render: (r) => formatDate(r.expenseDate) },
    { key: "business", header: "עסק", render: (r) => r.businessName ?? r.description ?? "—" },
    { key: "category", header: "קטגוריה", render: (r) => r.categoryName ?? "—" },
    { key: "method", header: "אמצעי תשלום", render: (r) => r.paymentMethodName ?? "—" },
    { key: "source", header: "מקור", render: (r) => r.source },
    { key: "amount", header: "סכום", align: "left", render: (r) => <span className="mono">{formatCurrency(r.amount)}</span> },
  ];

  const budgetColumns: Column<CrmBudget>[] = [
    { key: "period", header: "תקופה", render: (r) => `${r.month}/${r.year}` },
    { key: "category", header: "קטגוריה", render: (r) => r.categoryName ?? "—" },
    { key: "amount", header: "תקציב", align: "left", render: (r) => <span className="mono">{formatCurrency(r.amount)}</span> },
  ];

  const loanColumns: Column<CrmLoan>[] = [
    { key: "name", header: "הלוואה", render: (r) => <><strong>{r.loanName}</strong>{r.loanNumber ? <span className="text-muted"> · {r.loanNumber}</span> : null}</> },
    { key: "lender", header: "גורם מלווה", render: (r) => r.lenderName ?? "—" },
    { key: "type", header: "סוג", render: (r) => r.loanType },
    { key: "status", header: "סטטוס", render: (r) => <span className={`crm-pill crm-pill-${r.status === "active" ? "active" : r.status === "overdue" ? "danger" : "empty"}`}>{LOAN_STATUS_LABEL[r.status] ?? r.status}</span> },
    { key: "balance", header: "יתרה נוכחית", align: "left", render: (r) => <span className="mono">{formatCurrency(r.currentBalance)}</span> },
    { key: "monthly", header: "תשלום חודשי", align: "left", render: (r) => <span className="mono">{formatCurrency(r.monthlyPayment)}</span> },
    { key: "schedule", header: "שורות לוח סילוקין", render: (r) => String(r.scheduleEntryCount) },
  ];

  const accountColumns: Column<CrmBankAccount>[] = [
    { key: "bank", header: "בנק", render: (r) => r.bankName },
    { key: "account", header: "שם חשבון", render: (r) => r.accountName },
    { key: "balance", header: "יתרה", align: "left", render: (r) => <span className="mono">{formatCurrency(r.currentBalance)}</span> },
    { key: "tx", header: "תנועות", render: (r) => String(r.transactionCount) },
    { key: "statements", header: "דפי בנק שיובאו", render: (r) => String(r.statementCount) },
  ];

  const bankTxColumns: Column<CrmBankTransaction>[] = [
    { key: "date", header: "תאריך", render: (r) => formatDate(r.transactionDate) },
    { key: "account", header: "חשבון", render: (r) => `${r.bankName} · ${r.accountName}` },
    { key: "desc", header: "תיאור", render: (r) => r.description ?? "—" },
    { key: "status", header: "התאמה", render: (r) => r.reconcileStatus },
    { key: "amount", header: "סכום", align: "left", render: (r) => <span className="mono">{formatCurrency(r.amount)}</span> },
  ];

  const creditColumns: Column<CrmCreditImport>[] = [
    { key: "file", header: "קובץ", render: (r) => r.fileName },
    { key: "period", header: "תקופה", render: (r) => `${r.importMonth}/${r.importYear}` },
    { key: "status", header: "סטטוס", render: (r) => r.status },
    { key: "count", header: "תנועות", render: (r) => String(r.transactionCount) },
    { key: "amount", header: "סה״כ", align: "left", render: (r) => <span className="mono">{formatCurrency(r.totalAmount)}</span> },
  ];

  const recurringColumns: Column<CrmRecurringPayment>[] = [
    { key: "name", header: "שם", render: (r) => r.name },
    { key: "category", header: "קטגוריה", render: (r) => r.categoryName ?? "—" },
    { key: "freq", header: "תדירות", render: (r) => r.frequency },
    { key: "next", header: "תשלום הבא", render: (r) => formatDate(r.nextPaymentDate) },
    { key: "amount", header: "סכום", align: "left", render: (r) => <span className="mono">{formatCurrency(r.amount)}</span> },
  ];

  const subscriptionColumns: Column<CrmSubscription>[] = [
    { key: "name", header: "שם", render: (r) => r.name },
    { key: "status", header: "סטטוס", render: (r) => SUB_STATUS_LABEL[r.status] ?? r.status },
    { key: "freq", header: "תדירות", render: (r) => r.frequency },
    { key: "billing", header: "חיוב הבא", render: (r) => formatDate(r.billingDate) },
    { key: "amount", header: "סכום", align: "left", render: (r) => <span className="mono">{formatCurrency(r.amount)}</span> },
  ];

  const savingsColumns: Column<CrmSavingsGoal>[] = [
    { key: "name", header: "יעד", render: (r) => r.goalName },
    { key: "current", header: "נצבר", align: "left", render: (r) => <span className="mono">{formatCurrency(r.currentAmount)}</span> },
    { key: "target", header: "יעד לחיסכון", align: "left", render: (r) => <span className="mono">{formatCurrency(r.targetAmount)}</span> },
    { key: "date", header: "תאריך יעד", render: (r) => (r.targetDate ? formatDate(r.targetDate) : "—") },
  ];

  const paymentMethodColumns: Column<CrmPaymentMethod>[] = [
    { key: "name", header: "שם", render: (r) => r.name },
    { key: "type", header: "סוג", render: (r) => r.type },
    { key: "default", header: "ברירת מחדל", render: (r) => (r.isDefault ? "כן" : "לא") },
  ];

  const documentColumns: Column<CrmDocument>[] = [
    { key: "file", header: "קובץ", render: (r) => r.fileName },
    { key: "kind", header: "סוג", render: (r) => r.kind },
    { key: "status", header: "סטטוס", render: (r) => r.status },
    { key: "rows", header: "שורות (יובאו/סה״כ)", render: (r) => `${r.rowsImported}/${r.rowsParsed}` },
    { key: "uploaded", header: "הועלה", render: (r) => formatDate(r.uploadedAt) },
  ];

  const alertColumns: Column<CrmAlert>[] = [
    { key: "title", header: "כותרת", render: (r) => r.title },
    { key: "severity", header: "חומרה", render: (r) => <span className={`crm-pill crm-pill-${r.severity === "critical" ? "danger" : r.severity === "warning" ? "warning" : "empty"}`}>{SEVERITY_LABEL[r.severity] ?? r.severity}</span> },
    { key: "read", header: "נקראה", render: (r) => (r.isRead ? "כן" : "לא") },
    { key: "created", header: "נוצרה", render: (r) => formatDate(r.createdAt) },
  ];

  const reminderColumns: Column<CrmReminder>[] = [
    { key: "title", header: "כותרת", render: (r) => r.title },
    { key: "type", header: "סוג", render: (r) => r.type },
    { key: "date", header: "תאריך", render: (r) => formatDate(r.eventDate) },
    { key: "active", header: "פעיל", render: (r) => (r.isActive ? "כן" : "לא") },
    { key: "amount", header: "סכום משוער", align: "left", render: (r) => (r.estimatedAmount ? <span className="mono">{formatCurrency(r.estimatedAmount)}</span> : "—") },
  ];

  return (
    <PageShell
      toolbar={
        <div className="crm-detail-toolbar">
          <Link to="/crm/customers" className="crm-topbar-back">
            ‹ חזרה לרשימת הלקוחות
          </Link>
          {/* Backend-enforced too (requireRole("ADMIN") on PATCH /crm/customers/:id)
              — hiding these for VIEWER here is UX, not the real authorization. */}
          {isAdmin && (
            <div className="crm-toolbar-actions">
              <Button
                variant="ghost"
                onClick={() => openEdit(data.profile.name, data.profile.email, data.profile.role)}
              >
                ✏️ עריכת פרטים
              </Button>
              <Button
                variant={data.profile.status === "active" ? "danger" : "outline"}
                disabled={isSelf}
                title={isSelf ? "אי אפשר להשבית את המשתמש הפעיל" : undefined}
                onClick={() => askToggleStatus(data.profile.name, data.profile.status === "active")}
              >
                {data.profile.status === "active" ? "⛔ השבתת חשבון" : "✅ הפעלת חשבון"}
              </Button>
            </div>
          )}
        </div>
      }
      hero={
        <div className="crm-profile-hero">
          <span className="crm-avatar crm-avatar-lg" aria-hidden>
            👤
          </span>
          <div>
            <h1 className="crm-profile-name">{data.profile.name}</h1>
            <div className="text-muted">
              לקוח #{data.profile.id}
              {data.profile.email && <> · {data.profile.email}</>} · נוצר {formatDate(data.profile.createdAt)} ·
              עודכן לאחרונה {formatDate(data.profile.updatedAt)}
            </div>
            <div className="crm-profile-badges">
              <span className="crm-pill crm-pill-role">{ROLE_LABELS[data.profile.role]}</span>
              {data.profile.status === "active" ? (
                <span className="crm-pill crm-pill-active">פעיל</span>
              ) : (
                <span className="crm-pill crm-pill-danger">מושבת</span>
              )}
            </div>
          </div>
        </div>
      }
      summary={
        <div className="kpi-row">
          <SummaryCard label="סה״כ הכנסות" value={formatCurrency(data.financials.incomeTotal)} icon="💰" />
          <SummaryCard label="סה״כ הוצאות" value={formatCurrency(data.financials.expenseTotal)} icon="💸" />
          <SummaryCard
            label="תזרים נטו"
            value={formatCurrency(data.financials.incomeTotal - data.financials.expenseTotal, { sign: true })}
            icon="⚖️"
            tone={data.financials.incomeTotal - data.financials.expenseTotal >= 0 ? "success" : "danger"}
          />
          <SummaryCard
            label="יתרת הלוואות פעילות"
            value={formatCurrency(data.loans.filter((l) => l.status === "active").reduce((s, l) => s + l.currentBalance, 0))}
            icon="📉"
          />
          <SummaryCard label="יתרת חשבונות בנק" value={formatCurrency(data.bank.totalBalance)} icon="🏦" />
        </div>
      }
    >
      <Card title="הגדרות ואפיון אישי" className="crm-section">
        {data.settings ? (
          <div className="crm-kv-grid">
            <div>
              <span className="text-muted">מטבע</span>
              <div>{data.settings.currency}</div>
            </div>
            <div>
              <span className="text-muted">שפה</span>
              <div>{data.settings.language}</div>
            </div>
            <div>
              <span className="text-muted">ערכת נושא</span>
              <div>{data.settings.theme}</div>
            </div>
            <div>
              <span className="text-muted">פורמט תאריך</span>
              <div>{data.settings.dateFormat}</div>
            </div>
            <div>
              <span className="text-muted">יעד חודשי</span>
              <div>{data.settings.monthlyTarget ? formatCurrency(data.settings.monthlyTarget) : "—"}</div>
            </div>
            <div>
              <span className="text-muted">חודש פעיל</span>
              <div>{data.settings.activeMonth ?? "—"}</div>
            </div>
            <div>
              <span className="text-muted">קטגוריות מותאמות אישית</span>
              <div>{data.personalization.customCategoriesCount}</div>
            </div>
            <div>
              <span className="text-muted">כללי סיווג מותאמים אישית</span>
              <div>{data.personalization.customCategoryRulesCount}</div>
            </div>
          </div>
        ) : (
          <EmptyState icon="⚙️" title="לא הוגדרו הגדרות אישיות" hint="נוצרות אוטומטית עם הכניסה הראשונה של המשתמש לאפליקציה" />
        )}
        <p className="text-muted crm-hint">
          המערכת שומרת שם ואימייל להתחברות בלבד — אין שדות טלפון או כתובת עבור חשבונות משתמש.
        </p>
      </Card>

      <Section title="בני משפחה" count={data.familyMembers.length}>
        <Table
          columns={familyColumns}
          rows={data.familyMembers}
          rowKey={(r) => r.id}
          emptyState={
            <EmptyState
              icon="👨‍👩‍👧"
              title="אין בני משפחה"
              hint="בני משפחה הם רישום שיוך בלבד — אינם חשבונות התחברות ואינם בעלי נתונים כספיים משלהם"
            />
          }
        />
      </Section>

      <Section title="הכנסות" count={data.financials.incomes.length}>
        <Table
          columns={incomeColumns}
          rows={data.financials.incomes}
          rowKey={(r) => r.id}
          emptyState={<EmptyState icon="💰" title="אין הכנסות רשומות" />}
        />
      </Section>

      <Section title="הוצאות" count={data.financials.expenses.length}>
        <Table
          columns={expenseColumns}
          rows={data.financials.expenses}
          rowKey={(r) => r.id}
          emptyState={<EmptyState icon="💸" title="אין הוצאות רשומות" />}
        />
      </Section>

      <Section title="תקציבים" count={data.financials.budgets.length}>
        <Table
          columns={budgetColumns}
          rows={data.financials.budgets}
          rowKey={(r) => r.id}
          emptyState={<EmptyState icon="📊" title="לא הוגדרו תקציבים" />}
        />
      </Section>

      <Section title="הלוואות" count={data.loans.length}>
        <Table
          columns={loanColumns}
          rows={data.loans}
          rowKey={(r) => r.id}
          emptyState={<EmptyState icon="📉" title="אין הלוואות רשומות" />}
        />
      </Section>

      <Section title="חשבונות בנק" count={data.bank.accounts.length}>
        <Table
          columns={accountColumns}
          rows={data.bank.accounts}
          rowKey={(r) => r.id}
          emptyState={<EmptyState icon="🏦" title="אין חשבונות בנק מקושרים" />}
        />
        {data.bank.recentTransactions.length > 0 && (
          <>
            <h4 className="crm-subsection-title">תנועות בנק אחרונות</h4>
            <Table columns={bankTxColumns} rows={data.bank.recentTransactions} rowKey={(r) => r.id} pageSize={10} />
          </>
        )}
      </Section>

      <Section title="ייבוא כרטיסי אשראי" count={data.credit.imports.length}>
        <Table
          columns={creditColumns}
          rows={data.credit.imports}
          rowKey={(r) => r.id}
          emptyState={<EmptyState icon="💳" title="לא יובאו דוחות אשראי" />}
        />
      </Section>

      <Section title="תשלומים קבועים" count={data.recurringPayments.length}>
        <Table
          columns={recurringColumns}
          rows={data.recurringPayments}
          rowKey={(r) => r.id}
          emptyState={<EmptyState icon="🔁" title="אין תשלומים קבועים" />}
        />
      </Section>

      <Section title="מנויים" count={data.subscriptions.length}>
        <Table
          columns={subscriptionColumns}
          rows={data.subscriptions}
          rowKey={(r) => r.id}
          emptyState={<EmptyState icon="📱" title="אין מנויים רשומים" />}
        />
      </Section>

      <Section title="יעדי חיסכון" count={data.savingsGoals.length}>
        <Table
          columns={savingsColumns}
          rows={data.savingsGoals}
          rowKey={(r) => r.id}
          emptyState={<EmptyState icon="🎯" title="לא הוגדרו יעדי חיסכון" />}
        />
      </Section>

      <Section title="אמצעי תשלום" count={data.paymentMethods.length}>
        <Table
          columns={paymentMethodColumns}
          rows={data.paymentMethods}
          rowKey={(r) => r.id}
          emptyState={<EmptyState icon="💳" title="לא הוגדרו אמצעי תשלום אישיים" hint="ייתכן שנעשה שימוש באמצעי תשלום ברירת המחדל של המערכת" />}
        />
      </Section>

      <Section title="מסמכים שהועלו" count={data.documents.length}>
        <Table
          columns={documentColumns}
          rows={data.documents}
          rowKey={(r) => r.id}
          emptyState={<EmptyState icon="📄" title="לא הועלו מסמכים" />}
        />
      </Section>

      <Section title="התראות" count={data.alerts.length}>
        <Table
          columns={alertColumns}
          rows={data.alerts}
          rowKey={(r) => r.id}
          emptyState={<EmptyState icon="🔔" title="אין התראות" />}
        />
      </Section>

      <Section title="תזכורות" count={data.reminders.length}>
        <Table
          columns={reminderColumns}
          rows={data.reminders}
          rowKey={(r) => r.id}
          emptyState={<EmptyState icon="⏰" title="אין תזכורות" />}
        />
      </Section>

      <Modal title="עריכת פרטי לקוח" open={editOpen} onClose={() => setEditOpen(false)}>
        <form onSubmit={submitEdit}>
          {error && <ErrorMessage message={error} />}
          <Input label="שם" required value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          <Input label="אימייל" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <Select
            label="תפקיד"
            options={ROLE_OPTIONS}
            value={role}
            disabled={isSelf}
            onChange={(e) => setRole(e.target.value as CrmRole)}
          />
          {isSelf && <p className="text-muted crm-hint">אי אפשר לשנות את התפקיד של המשתמש הפעיל.</p>}
          <Input
            label="סיסמה חדשה (השאירי ריק כדי לא לשנות)"
            type="password"
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <div className="modal-actions">
            <Button type="submit" disabled={busy}>
              עדכון
            </Button>
            <Button type="button" variant="ghost" onClick={() => setEditOpen(false)}>
              ביטול
            </Button>
          </div>
        </form>
      </Modal>

      {confirm.dialog}
    </PageShell>
  );
}
