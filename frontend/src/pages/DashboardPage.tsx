import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "../components/common/Button";
import { Card } from "../components/common/Card";
import { EmptyState } from "../components/common/EmptyState";
import { Loading } from "../components/common/Loading";
import { CategoryBarChart } from "../components/dashboard/CategoryBarChart";
import { InsightsPanel } from "../components/dashboard/InsightsPanel";
import { LoanSplitChart } from "../components/dashboard/LoanSplitChart";
import { MonthlyTrendChart } from "../components/dashboard/MonthlyTrendChart";
import { PaceAlertBanner } from "../components/dashboard/PaceAlertBanner";
import { SummaryCard } from "../components/dashboard/SummaryCard";
import { UpdatesTicker } from "../components/dashboard/UpdatesTicker";
import { ReminderForm } from "../components/reminders/ReminderForm";
import { useMonth } from "../context/MonthContext";
import { getCharts, getInsights, getRecent, getSummary } from "../services/dashboard.service";
import { listAlerts } from "../services/planning.service";
import type { DashboardCharts, DashboardSummary, RecentLists } from "../types/dashboard.types";
import type { Alert, DashboardInsights } from "../types/models";
import { formatCurrency, formatDate } from "../utils/format";

export default function DashboardPage() {
  const { monthKey } = useMonth();
  const navigate = useNavigate();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [charts, setCharts] = useState<DashboardCharts | null>(null);
  const [recent, setRecent] = useState<RecentLists | null>(null);
  const [insights, setInsights] = useState<DashboardInsights | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [reminderOpen, setReminderOpen] = useState(false);
  const [tickerKey, setTickerKey] = useState(0);

  const load = useCallback(() => {
    getSummary(monthKey).then(setSummary).catch(() => {});
    getCharts(monthKey).then(setCharts).catch(() => {});
    getRecent().then(setRecent).catch(() => {});
    getInsights(monthKey).then(setInsights).catch(() => {});
    listAlerts()
      .then((all) => setAlerts(all.filter((a) => !a.isRead && a.severity !== "info").slice(0, 4)))
      .catch(() => {});
  }, [monthKey]);

  useEffect(load, [load]);

  if (!summary) return <Loading />;

  const hasBudget = summary.budget.total > 0;

  return (
    <>
      <UpdatesTicker key={tickerKey} />

      <div className="dashboard-actions">
        <Button onClick={() => navigate("/expenses", { state: { openForm: true } })}>+ הוספת הוצאה</Button>
        <Button variant="outline" onClick={() => navigate("/imports")}>ייבוא אקסל 📂</Button>
        {alerts.map((alert) => (
          <Link key={alert.id} to="/alerts" className={`alert-chip alert-chip-${alert.severity}`}>
            {alert.title}
          </Link>
        ))}
      </div>

      <div className="hero-grid">
        <SummaryCard
          label="נשאר החודש"
          value={formatCurrency(summary.balance)}
          tone={summary.balance >= 0 ? "primary" : "danger"}
          size="hero"
        />
        <SummaryCard label="הכנסות" value={formatCurrency(summary.incomeTotal)} tone="success" size="hero" />
        <SummaryCard label="הוצאות" value={formatCurrency(summary.expenseTotal)} tone="danger" size="hero" />
      </div>

      {insights?.paceAlert && <PaceAlertBanner data={insights.paceAlert} />}

      {insights && <InsightsPanel data={insights} />}

      <div className="stats-strip">
        {hasBudget && (
          <SummaryCard
            label="ניצול תקציב"
            value={`${Math.round(summary.budget.usedPercent)}%`}
            tone={summary.budget.usedPercent > 100 ? "danger" : summary.budget.usedPercent >= 85 ? "warning" : "success"}
            sub={summary.budget.overrunCount > 0 ? `${summary.budget.overrunCount} בחריגה` : undefined}
          />
        )}
        {summary.creditTotal > 0 && <SummaryCard label="הוצאות אשראי" value={formatCurrency(summary.creditTotal)} />}
        {summary.savingsMonthly > 0 && (
          <SummaryCard label="חיסכון חודשי" value={formatCurrency(summary.savingsMonthly)} tone="success" />
        )}
        {summary.loans.count > 0 && (
          <>
            <SummaryCard label="החזרי הלוואות" value={formatCurrency(summary.loans.monthlyPayment)} />
            <SummaryCard
              label="ריבית חודשית"
              value={formatCurrency(summary.loans.monthlyInterest)}
              tone={summary.loans.monthlyInterest > 0 ? "warning" : "default"}
            />
            <SummaryCard
              label="יתרת הלוואות"
              value={formatCurrency(summary.loans.totalBalance)}
              sub={`${summary.loans.count} פעילות`}
            />
          </>
        )}
      </div>

      <div className="charts-grid">
        <Card title="הכנסות מול הוצאות — 6 חודשים">
          {charts && charts.trend.some((t) => t.income > 0 || t.expense > 0) ? (
            <MonthlyTrendChart data={charts.trend} />
          ) : (
            <EmptyState icon="📈" title="אין עדיין נתונים" hint="הוסיפי הכנסות והוצאות כדי לראות מגמה" />
          )}
        </Card>
        <Card title="הוצאות לפי קטגוריה">
          {charts && charts.byCategory.length > 0 ? (
            <CategoryBarChart data={charts.byCategory} />
          ) : (
            <EmptyState icon="🥧" title="אין הוצאות החודש" />
          )}
        </Card>
        {charts && charts.loanSplit.length > 0 && (
          <Card title="הלוואות — ריבית מול קרן (חודשי)">
            <LoanSplitChart data={charts.loanSplit} />
          </Card>
        )}
        {charts && charts.creditByCategory.length > 0 && (
          <Card title="אשראי לפי קטגוריה">
            <CategoryBarChart data={charts.creditByCategory} />
          </Card>
        )}
      </div>

      <div className="recent-grid">
        <Card
          title="הוצאות אחרונות"
          action={
            <Button size="sm" variant="outline" onClick={() => setReminderOpen(true)}>
              + תזכורת
            </Button>
          }
        >
          {recent && recent.expenses.length > 0 ? (
            <ul className="recent-list">
              {recent.expenses.map((expense) => (
                <li key={expense.id}>
                  <span className="recent-icon">{expense.category?.icon ?? "🧾"}</span>
                  <span className="recent-name">{expense.businessName || expense.description || expense.category?.name || "הוצאה"}</span>
                  <span className="recent-date">{formatDate(expense.expenseDate)}</span>
                  <span className="recent-amount mono text-danger">{formatCurrency(Number(expense.amount))}</span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon="🧾" title="אין הוצאות עדיין" />
          )}
        </Card>
        <Card title="הכנסות אחרונות">
          {recent && recent.incomes.length > 0 ? (
            <ul className="recent-list">
              {recent.incomes.map((income) => (
                <li key={income.id}>
                  <span className="recent-icon">💰</span>
                  <span className="recent-name">{income.description || income.type}</span>
                  <span className="recent-date">{formatDate(income.incomeDate)}</span>
                  <span className="recent-amount mono text-success">{formatCurrency(Number(income.amount))}</span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon="💰" title="אין הכנסות עדיין" />
          )}
        </Card>
        <Card title="עסקאות אשראי אחרונות">
          {recent && recent.credit.length > 0 ? (
            <ul className="recent-list">
              {recent.credit.map((tx) => (
                <li key={tx.id}>
                  <span className="recent-icon">{tx.category?.icon ?? "💳"}</span>
                  <span className="recent-name">{tx.businessName}</span>
                  <span className="recent-date">{formatDate(tx.transactionDate)}</span>
                  <span className="recent-amount mono">{formatCurrency(Number(tx.amount))}</span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon="💳" title="אין עסקאות אשראי" hint="ייבאי קובץ אקסל בעמוד האשראי" />
          )}
        </Card>
      </div>

      <ReminderForm
        open={reminderOpen}
        onClose={() => setReminderOpen(false)}
        onSaved={() => {
          setTickerKey((k) => k + 1);
          load();
        }}
      />
    </>
  );
}
