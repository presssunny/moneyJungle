import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AsyncSection } from "../components/common/AsyncSection";
import { Button } from "../components/common/Button";
import { Card } from "../components/common/Card";
import { EmptyState } from "../components/common/EmptyState";
import { QuickAddBar } from "../components/common/QuickAddBar";
import { SkeletonCard, SkeletonChart, SkeletonRows } from "../components/common/Skeleton";
import { AchievementsPanel } from "../components/dashboard/AchievementsPanel";
import { AttentionPanel, type AttentionItem } from "../components/dashboard/AttentionPanel";
import { CategoryBarChart } from "../components/dashboard/CategoryBarChart";
import { InsightsPanel } from "../components/dashboard/InsightsPanel";
import { MonthlyTrendChart } from "../components/dashboard/MonthlyTrendChart";
import { PaceAlertBanner } from "../components/dashboard/PaceAlertBanner";
import { SummaryCard } from "../components/dashboard/SummaryCard";
import { UpcomingPanel } from "../components/dashboard/UpcomingPanel";
import { UpdatesTicker } from "../components/dashboard/UpdatesTicker";
import { ReminderForm } from "../components/reminders/ReminderForm";
import { useMonth } from "../context/MonthContext";
import { useAsync } from "../hooks/useAsync";
import {
  getAchievements,
  getCharts,
  getInsights,
  getRecent,
  getSummary,
  getUpcoming,
} from "../services/dashboard.service";
import { listCreditImports } from "../services/finance.service";
import { listAlerts } from "../services/planning.service";
import type { DashboardSummary } from "../types/dashboard.types";
import { formatCurrency, formatDate } from "../utils/format";

/**
 * טאב "בית" — the state-and-direction tab (IA §3): "am I OK right now, and
 * where is this heading?". Raw totals (income / expenses / credit / loans) moved
 * to their own tabs per the no-duplicate-KPI rule (§1.1); what is left here is
 * the daily check-in plus a list of things that need attention.
 */
export default function DashboardPage() {
  const { monthKey } = useMonth();
  const navigate = useNavigate();
  const [reminderOpen, setReminderOpen] = useState(false);
  const [tickerKey, setTickerKey] = useState(0);

  // One resource per widget: a failure in any of these is visible and retryable
  // on its own, and never blanks the rest of the page (§1.3).
  const summaryRes = useAsync(() => getSummary(monthKey), [monthKey], "לא הצלחנו לטעון את נתוני החודש");
  const chartsRes = useAsync(() => getCharts(monthKey), [monthKey], "לא הצלחנו לטעון את הגרפים");
  const insightsRes = useAsync(() => getInsights(monthKey), [monthKey], "התובנות לא זמינות כרגע");
  const recentRes = useAsync(() => getRecent(), [monthKey], "לא הצלחנו לטעון את התנועות");
  const achievementsRes = useAsync(() => getAchievements(monthKey), [monthKey], "לא הצלחנו לטעון את ההישגים");
  const upcomingRes = useAsync(() => getUpcoming(45), [monthKey], "לא הצלחנו לטעון את התשלומים הקרובים");
  const alertsRes = useAsync(() => listAlerts(), [monthKey], "לא הצלחנו לטעון את ההתראות");
  const creditRes = useAsync(() => listCreditImports(), [monthKey], "לא הצלחנו לטעון את ייבואי האשראי");

  function reloadAll() {
    summaryRes.reload();
    chartsRes.reload();
    insightsRes.reload();
    recentRes.reload();
    achievementsRes.reload();
    upcomingRes.reload();
    alertsRes.reload();
    creditRes.reload();
  }

  const summary = summaryRes.data;
  const insights = insightsRes.data;

  // Brand-new account: no income, no expenses, no credit. Four ₪0 cards read as
  // a malfunction, so we show one welcome screen instead (§3.5).
  const isBrandNew =
    summary !== null && summary.incomeTotal === 0 && summary.expenseTotal === 0 && summary.creditTotal === 0;

  const attention: AttentionItem[] = [];
  if (summary && summary.budget.overrunCount > 0) {
    attention.push({
      id: "budget",
      icon: "🎯",
      text: `חריגה ב־${summary.budget.overrunCount} קטגוריות תקציב`,
      to: "/budgets",
      tone: "warning",
    });
  }
  // Money that exists but sits in no total is the one thing the dashboard must
  // never stay quiet about — so an unresolved row is critical, not a warning.
  if (summary && summary.bankReview.unresolvedCount > 0) {
    attention.push({
      id: "bank-unresolved",
      icon: "🚧",
      text: `${summary.bankReview.unresolvedCount} תנועות בנק ללא סיווג — לא נספרות באף מספר`,
      to: "/accounts?tab=reconcile",
      tone: "critical",
    });
  } else if (summary && summary.bankReview.pendingCount > 0) {
    attention.push({
      id: "bank-review",
      icon: "🏦",
      text: `${summary.bankReview.pendingCount} תנועות בנק ממתינות לסיווג`,
      to: "/accounts?tab=reconcile",
      tone: "warning",
    });
  }
  // Resolved, counted, but coarse: a card bill with no itemized statement behind
  // it, or a loan received whose terms are unknown. Worth a look, not an alarm.
  if (summary && summary.bankReview.needsAttention > 0) {
    attention.push({
      id: "bank-coarse",
      icon: "💳",
      text:
        summary.bankMonth.unitemizedCard > 0
          ? `${formatCurrency(summary.bankMonth.unitemizedCard)} חיובי אשראי ללא פירוט — נספרים כהוצאה אחת`
          : `${formatCurrency(summary.bankMonth.loanDrawdown)} הלוואה שהתקבלה — יש להשלים את תנאי ההלוואה`,
      to: "/accounts?tab=reconcile",
      tone: "info",
    });
  }
  const pendingCredit = (creditRes.data ?? []).filter((imp) => imp.status !== "confirmed");
  if (pendingCredit.length > 0) {
    const pendingTx = pendingCredit.reduce((sum, imp) => sum + imp.totalTransactions, 0);
    attention.push({
      id: "credit",
      icon: "💳",
      text: `${pendingTx} עסקאות אשראי ממתינות לאישור`,
      to: "/accounts?tab=credit",
      tone: "warning",
    });
  }
  for (const alert of (alertsRes.data ?? []).filter((a) => !a.isRead && a.severity !== "info").slice(0, 2)) {
    attention.push({ id: `alert-${alert.id}`, icon: "🚨", text: alert.title, to: "/manage?tab=alerts", tone: alert.severity });
  }

  if (isBrandNew) {
    return (
      <>
        <QuickAddBar onAdded={reloadAll} />
        <Card>
          <EmptyState
            icon="🌴"
            title="ברוכה הבאה — עוד לא נכנסו נתונים"
            hint="הדרך המהירה: ייבוא דוח אשראי או דף חשבון בנק"
            action={
              <div className="row-actions">
                <Button onClick={() => navigate("/transactions?tab=import")}>ייבוא קובץ 📂</Button>
                <Button
                  variant="outline"
                  onClick={() => navigate("/transactions?tab=expenses", { state: { openForm: true } })}
                >
                  הוספה ידנית
                </Button>
              </div>
            }
          />
        </Card>
      </>
    );
  }

  return (
    <>
      <UpdatesTicker key={tickerKey} />

      <div className="page-toolbar">
        <Button onClick={() => navigate("/transactions?tab=expenses", { state: { openForm: true } })}>
          + הוספת הוצאה
        </Button>
        <Button variant="outline" onClick={() => navigate("/transactions?tab=import")}>
          ייבוא אקסל 📂
        </Button>
      </div>

      <QuickAddBar onAdded={reloadAll} />

      {/* The plain question first: what came in, what went out, what is left.
          Everything below this row is derived from these three numbers, and a
          derived figure is unreadable while its inputs are off-screen. */}
      <AsyncSection
        resource={summaryRes}
        errorTitle="לא הצלחנו לטעון את נתוני החודש"
        skeleton={<SkeletonCard />}
      >
        {(data) => (
          <div className="kpi-row kpi-row-hero">
            <SummaryCard
              label="נכנס החודש"
              icon="💰"
              value={formatCurrency(data.incomeTotal)}
              tone="success"
              size="hero"
              onClick={() => navigate("/transactions?tab=incomes")}
            />
            <SummaryCard
              label="יצא החודש"
              icon="🧾"
              value={formatCurrency(data.expenseTotal)}
              tone="danger"
              size="hero"
              sub={data.creditTotal > 0 ? `כולל ${formatCurrency(data.creditTotal)} אשראי` : undefined}
              onClick={() => navigate("/transactions?tab=expenses")}
            />
            <SummaryCard
              label="נשאר"
              icon={data.balance >= 0 ? "🟢" : "🔴"}
              value={formatCurrency(data.balance)}
              tone={data.balance >= 0 ? "primary" : "danger"}
              size="hero"
              accent
              sub={data.balance >= 0 ? "נכנס פחות יצא" : "יצא יותר ממה שנכנס"}
              footnote={
                data.bankReview.pendingCount > 0
                  ? `${data.bankReview.pendingCount} תנועות בנק עוד לא נספרות`
                  : undefined
              }
            />
          </div>
        )}
      </AsyncSection>

      {/* Money that left the account this month and is deliberately NOT in "יצא
          החודש": loan principal lowers debt, a settled card bill is itemized in
          the credit tab, an internal transfer is not a payment. Without this the
          statement and the dashboard look like they disagree — they don't, and
          this is the line that proves it. */}
      {summary && <NonSpendingRow bank={summary.bankMonth} />}

      {/* KPI row (§3.1). Two resources feed it, each failing independently. */}
      <div className="kpi-row kpi-row-hero">
        <AsyncSection
          resource={insightsRes}
          errorTitle="לא הצלחנו לטעון את מצב היום"
          skeleton={<SkeletonCard />}
        >
          {(data) => (
            <>
              {/* "Safe to spend today" only exists for a month in progress. */}
              {data.safePerDay != null && (
                <SummaryCard
                  label="מותר להוציא היום"
                  icon="💸"
                  value={formatCurrency(data.safePerDay)}
                  tone={data.safePerDay > 0 ? "primary" : "danger"}
                  sub={
                    data.safePerDay > 0
                      ? `נותרו ${data.daysLeft} ימים החודש`
                      : "אין יתרה פנויה — האטי את הקצב"
                  }
                  size="hero"
                  accent
                />
              )}
            </>
          )}
        </AsyncSection>

        <AsyncSection
          resource={summaryRes}
          errorTitle="לא הצלחנו לטעון את נתוני החודש"
          skeleton={<SkeletonCard />}
        >
          {(data) => (
            <SummaryCard
              label="נשאר החודש"
              value={formatCurrency(data.balance)}
              tone={data.balance >= 0 ? "primary" : "danger"}
              size="hero"
            />
          )}
        </AsyncSection>

        <AsyncSection resource={insightsRes} errorTitle="התחזית לא זמינה" skeleton={<SkeletonCard />}>
          {(data) => (
            <>
              {/* A projection is an assumption, not a measurement — marked as such (§1.2). */}
              <SummaryCard
                label="תחזית סוף חודש"
                value={formatCurrency(data.projection?.projectedBalance ?? 0)}
                certainty={data.projection ? "scenario" : "unknown"}
                size="hero"
                sub={data.projection ? `לפי קצב של ${formatCurrency(data.projection.dailyBurn)} ליום` : undefined}
              />
              <SummaryCard
                label="ציון בריאות"
                value={data.healthScore != null ? `${data.healthScore}/100` : "—"}
                certainty={data.healthScore != null ? "measured" : "unknown"}
                sub={data.scoreLabel}
                size="hero"
              />
            </>
          )}
        </AsyncSection>
      </div>

      {insights?.paceAlert && <PaceAlertBanner data={insights.paceAlert} />}

      <AttentionPanel items={attention} />

      <AsyncSection
        resource={insightsRes}
        errorTitle="התובנות לא זמינות כרגע"
        skeleton={<SkeletonChart height={180} label="טוען תובנות" />}
        isEmpty={(data) => data.insights.length === 0 && data.healthScore === null}
        emptyState={
          <Card>
            <EmptyState icon="💡" title="נאסוף עוד קצת נתונים ונחזור עם תובנות" />
          </Card>
        }
      >
        {(data) => <InsightsPanel data={data} />}
      </AsyncSection>

      <div className="dash-duo">
        <AsyncSection
          resource={achievementsRes}
          errorTitle="לא הצלחנו לטעון את ההישגים"
          skeleton={<SkeletonChart height={200} label="טוען הישגים" />}
        >
          {(data) => <AchievementsPanel data={data} />}
        </AsyncSection>
        <AsyncSection
          resource={upcomingRes}
          errorTitle="לא הצלחנו לטעון את התשלומים הקרובים"
          skeleton={<SkeletonChart height={200} label="טוען תשלומים קרובים" />}
        >
          {(data) => <UpcomingPanel data={data} />}
        </AsyncSection>
      </div>

      {/* Charts (§3.2) — loan split and credit-by-category moved to /accounts. */}
      <div className="charts-grid">
        <Card title="הכנסות מול הוצאות — 6 חודשים">
          <AsyncSection
            resource={chartsRes}
            errorTitle="לא הצלחנו לטעון את המגמה"
            skeleton={<SkeletonChart />}
            isEmpty={(data) => !data.trend.some((t) => t.income > 0 || t.expense > 0)}
            emptyState={
              <EmptyState
                icon="📈"
                title="אין עדיין נתונים למגמה"
                hint="כדי לראות מגמה צריך לפחות חודשיים של נתונים"
              />
            }
          >
            {(data) => <MonthlyTrendChart data={data.trend} />}
          </AsyncSection>
        </Card>

        <Card title="הוצאות לפי קטגוריה">
          <AsyncSection
            resource={chartsRes}
            errorTitle="לא הצלחנו לטעון את פילוח הקטגוריות"
            skeleton={<SkeletonChart />}
            isEmpty={(data) => data.byCategory.length === 0}
            emptyState={
              <EmptyState icon="🥧" title="אין הוצאות בחודש הזה" hint="הוסיפי הוצאה או ייבאי דוח אשראי" />
            }
          >
            {(data) => <CategoryBarChart data={data.byCategory} />}
          </AsyncSection>
        </Card>
      </div>

      {/* Recent activity. The single unified feed of §3.4 waits for the merged
          transactions endpoint (§9.3 / stage ד') — until then the three source
          lists stay, but each with its own empty and error state. */}
      <div className="recent-grid">
        <Card
          title="הוצאות אחרונות"
          action={
            <Button size="sm" variant="outline" onClick={() => setReminderOpen(true)}>
              + תזכורת
            </Button>
          }
        >
          <AsyncSection
            resource={recentRes}
            errorTitle="לא הצלחנו לטעון את ההוצאות האחרונות"
            skeleton={<SkeletonRows />}
            isEmpty={(data) => data.expenses.length === 0}
            emptyState={
              <EmptyState
                icon="🧾"
                title="אין עדיין הוצאות"
                hint="הוסיפי הוצאה, או ייבאי קובץ אקסל מהבנק / חברת האשראי"
                action={
                  <Button
                    size="sm"
                    onClick={() => navigate("/transactions?tab=expenses", { state: { openForm: true } })}
                  >
                    + הוספת הוצאה
                  </Button>
                }
              />
            }
          >
            {(data) => (
              <ul className="recent-list">
                {data.expenses.map((expense) => (
                  <li key={expense.id}>
                    <span className="recent-icon">{expense.category?.icon ?? "🧾"}</span>
                    <span className="recent-name">
                      {expense.businessName || expense.description || expense.category?.name || "הוצאה"}
                    </span>
                    <span className="recent-date">{formatDate(expense.expenseDate)}</span>
                    <span className="recent-amount mono text-danger">{formatCurrency(Number(expense.amount))}</span>
                  </li>
                ))}
              </ul>
            )}
          </AsyncSection>
        </Card>

        <Card title="הכנסות אחרונות">
          <AsyncSection
            resource={recentRes}
            errorTitle="לא הצלחנו לטעון את ההכנסות האחרונות"
            skeleton={<SkeletonRows />}
            isEmpty={(data) => data.incomes.length === 0}
            emptyState={<EmptyState icon="💰" title="אין עדיין הכנסות" hint="הוסיפי משכורת או כל הכנסה אחרת" />}
          >
            {(data) => (
              <ul className="recent-list">
                {data.incomes.map((income) => (
                  <li key={income.id}>
                    <span className="recent-icon">💰</span>
                    <span className="recent-name">{income.description || income.type}</span>
                    <span className="recent-date">{formatDate(income.incomeDate)}</span>
                    <span className="recent-amount mono text-success">{formatCurrency(Number(income.amount))}</span>
                  </li>
                ))}
              </ul>
            )}
          </AsyncSection>
        </Card>

        <Card title="עסקאות אשראי אחרונות">
          <AsyncSection
            resource={recentRes}
            errorTitle="לא הצלחנו לטעון את עסקאות האשראי"
            skeleton={<SkeletonRows />}
            isEmpty={(data) => data.credit.length === 0}
            emptyState={
              <EmptyState icon="💳" title="אין עסקאות אשראי" hint="ייבאי קובץ אקסל בטאב חשבונות ← אשראי" />
            }
          >
            {(data) => (
              <ul className="recent-list">
                {data.credit.map((tx) => (
                  <li key={tx.id}>
                    <span className="recent-icon">{tx.category?.icon ?? "💳"}</span>
                    <span className="recent-name">{tx.businessName}</span>
                    <span className="recent-date">{formatDate(tx.transactionDate)}</span>
                    <span className="recent-amount mono">{formatCurrency(Number(tx.amount))}</span>
                  </li>
                ))}
              </ul>
            )}
          </AsyncSection>
        </Card>
      </div>

      <ReminderForm
        open={reminderOpen}
        onClose={() => setReminderOpen(false)}
        onSaved={() => {
          setTickerKey((k) => k + 1);
          reloadAll();
        }}
      />
    </>
  );
}

/**
 * Bank money this month that is real but is not spending, each item naming the
 * figure that holds it instead. This is exactly the gap between "what left the
 * account" and "יצא החודש" — stating it makes the difference checkable.
 */
function NonSpendingRow({ bank }: { bank: DashboardSummary["bankMonth"] }) {
  const items: Array<{ label: string; value: number; hint: string }> = [
    {
      label: "הקטנת חוב",
      value: bank.debtReduction,
      hint:
        bank.loanUnsplit > 0
          ? `קרן ${formatCurrency(bank.principal)} + ${formatCurrency(bank.loanUnsplit)} ללא פירוט`
          : "תשלומי קרן הלוואה — לא הוצאה",
    },
    {
      label: "חיובי אשראי מפורטים",
      value: bank.cardSettled,
      hint: "העסקאות עצמן נספרות בטאב אשראי",
    },
    { label: "העברות פנימיות", value: bank.internalTransfer, hint: "בין חשבונות שלך — לא תשלום" },
    {
      label: "הלוואה שהתקבלה",
      value: bank.loanDrawdown,
      hint: "התחייבות חדשה — לא הכנסה",
    },
  ].filter((item) => item.value > 0);

  if (items.length === 0) return null;

  return (
    <Card title="יצא מהחשבון אבל אינו הוצאה">
      <ul className="attention-list non-spending-list">
        {items.map((item) => (
          <li key={item.label}>
            <span className="attention-text">
              {item.label}
              <small className="text-muted block">{item.hint}</small>
            </span>
            <span className="mono">{formatCurrency(item.value)}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
