import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AsyncSection } from "../components/common/AsyncSection";
import { PageShell } from "../components/common/PageShell";
import { Card } from "../components/common/Card";
import { EmptyState } from "../components/common/EmptyState";
import { QuickAddBar } from "../components/common/QuickAddBar";
import { SkeletonCard, SkeletonChart } from "../components/common/Skeleton";
import { TabbedHub } from "../components/common/TabbedHub";
import { CategoryBarChart } from "../components/dashboard/CategoryBarChart";
import { CategoryPieChart } from "../components/dashboard/CategoryPieChart";
import { chartChrome } from "../components/dashboard/chartTheme";
import { SummaryCard } from "../components/dashboard/SummaryCard";
import { useMonth } from "../context/MonthContext";
import { useAsync } from "../hooks/useAsync";
import { listExpenses, listIncomes } from "../services/finance.service";
import type { CategorySlice } from "../types/dashboard.types";
import type { Expense } from "../types/models";
import { formatCurrency } from "../utils/format";
import ExpensesPage from "./ExpensesPage";
import ImportsPage from "./ImportsPage";
import IncomesPage from "./IncomesPage";

const UNCATEGORIZED_COLOR = "#6D6875";

/** "על מה" — spend per category, from the rows already loaded. */
function categorySlices(rows: Expense[]): CategorySlice[] {
  const byCategory = new Map<string, CategorySlice>();
  for (const row of rows) {
    const value = Number(row.amount);
    const key = row.category?.name ?? "לא מסווג";
    const existing = byCategory.get(key);
    if (existing) existing.value += value;
    else
      byCategory.set(key, {
        name: key,
        color: row.category?.color ?? UNCATEGORIZED_COLOR,
        icon: row.category?.icon ?? undefined,
        value,
      });
  }
  return [...byCategory.values()];
}

/** "דרך מה" — spend per source. Answers a different question than the category
 *  split, which is why the two charts are not a duplicate (IA §4.3). */
function sourceSlices(rows: Expense[]): CategorySlice[] {
  const chrome = chartChrome();
  const buckets = [
    { key: "credit", name: "💳 אשראי", color: chrome.primary, value: 0 },
    { key: "bank", name: "🏦 בנק", color: chrome.secondary, value: 0 },
    { key: "manual", name: "🧾 ידני / מזומן", color: chrome.success, value: 0 },
  ];
  for (const row of rows) {
    const source = row.source ?? "manual";
    const bucket =
      source.startsWith("credit") ? buckets[0] : source.startsWith("bank") ? buckets[1] : buckets[2];
    bucket.value += Number(row.amount);
  }
  return buckets.filter((bucket) => bucket.value > 0);
}

/**
 * טאב "תנועות" — the raw-data tab (IA §4): "what actually happened, and is it
 * all classified?". The KPI row and the charts sit **above** the tabbed hub and
 * describe the whole month; the sub-tabs hold the tables and forms. That is
 * what turns the tab from a shell into a dashboard.
 */
export default function TransactionsPage() {
  const { monthKey } = useMonth();
  const navigate = useNavigate();
  // Bump to remount the active tab so it re-fetches after a quick add.
  const [refreshKey, setRefreshKey] = useState(0);

  const expensesRes = useAsync(
    () => listExpenses(monthKey),
    [monthKey, refreshKey],
    "לא הצלחנו לטעון את סיכום התנועות"
  );
  const incomesRes = useAsync(() => listIncomes(monthKey), [monthKey, refreshKey], "לא הצלחנו לטעון את ההכנסות");

  function refreshAll() {
    setRefreshKey((k) => k + 1);
  }

  const rows = expensesRes.data?.expenses ?? [];
  const uncategorized = rows.filter((row) => row.categoryId === null).length;
  const largest = rows.reduce((max, row) => Math.max(max, Number(row.amount)), 0);

  return (
    <PageShell>
      <QuickAddBar onAdded={refreshAll} />

      {/* KPI (§4.2) */}
      <div className="kpi-row">
        <AsyncSection
          resource={expensesRes}
          errorTitle="לא הצלחנו לטעון את סיכום התנועות"
          skeleton={<SkeletonCard />}
        >
          {(data) => (
            <>
              <SummaryCard label="הוצאות בחודש" value={formatCurrency(data.total)} tone="danger" />
              <SummaryCard
                label="מספר תנועות"
                value={String(data.expenses.length)}
                sub={
                  data.expenses.length > 0
                    ? `ממוצע ${formatCurrency(data.total / data.expenses.length)} לתנועה`
                    : undefined
                }
              />
              <SummaryCard
                label="לא מסווגות"
                value={String(uncategorized)}
                tone={uncategorized > 0 ? "warning" : "success"}
                sub={uncategorized > 0 ? "לחיצה מציגה רק אותן" : "הכול מסווג ✓"}
                onClick={
                  uncategorized > 0 ? () => navigate("/transactions?tab=expenses&uncat=1") : undefined
                }
              />
            </>
          )}
        </AsyncSection>

        <AsyncSection resource={incomesRes} errorTitle="לא הצלחנו לטעון את ההכנסות" skeleton={<SkeletonCard />}>
          {(data) => <SummaryCard label="הכנסות בחודש" value={formatCurrency(data.total)} tone="success" />}
        </AsyncSection>
      </div>

      {/* Charts (§4.3) */}
      <div className="charts-grid">
        <Card title="הוצאות לפי קטגוריה">
          <AsyncSection
            resource={expensesRes}
            errorTitle="לא הצלחנו לטעון את הפילוח"
            skeleton={<SkeletonChart />}
            isEmpty={(data) => data.expenses.length === 0}
            emptyState={
              <EmptyState icon="🥧" title="אין הוצאות בחודש שנבחר" hint="נסי לבחור חודש אחר, או הוסיפי הוצאה" />
            }
          >
            {(data) => (
              <>
                <CategoryBarChart data={categorySlices(data.expenses)} />
                <div className="chart-footnote">
                  ההוצאה הגדולה בחודש: <strong className="mono">{formatCurrency(largest)}</strong>
                </div>
              </>
            )}
          </AsyncSection>
        </Card>

        <Card title="דרך מה שילמנו">
          <AsyncSection
            resource={expensesRes}
            errorTitle="לא הצלחנו לטעון את הפילוח לפי מקור"
            skeleton={<SkeletonChart />}
            isEmpty={(data) => data.expenses.length === 0}
            emptyState={<EmptyState icon="💳" title="אין הוצאות בחודש שנבחר" />}
          >
            {(data) => <CategoryPieChart data={sourceSlices(data.expenses)} />}
          </AsyncSection>
        </Card>
      </div>

      <TabbedHub
        key={refreshKey}
        tabs={[
          { key: "expenses", label: "הוצאות", icon: "🧾", element: <ExpensesPage /> },
          { key: "incomes", label: "הכנסות", icon: "💰", element: <IncomesPage /> },
          { key: "import", label: "ייבוא אקסל", icon: "📂", element: <ImportsPage /> },
        ]}
      />
    </PageShell>
  );
}
