import { AsyncSection } from "../components/common/AsyncSection";
import { SkeletonCard } from "../components/common/Skeleton";
import { TabbedHub } from "../components/common/TabbedHub";
import { SummaryCard } from "../components/dashboard/SummaryCard";
import { useMonth } from "../context/MonthContext";
import { useAsync } from "../hooks/useAsync";
import { getMonthlyReport, getTrendReport } from "../services/finance.service";
import type { TrendRow } from "../types/models";
import { formatCurrency, formatMonthKey } from "../utils/format";
import ComparisonPage from "./ComparisonPage";
import ReportsPage from "./ReportsPage";

/** Months that actually have activity — averaging over empty months would understate. */
function activeMonths(trend: TrendRow[]): TrendRow[] {
  return trend.filter((row) => row.incomeTotal > 0 || row.expenseTotal > 0);
}

/**
 * טאב "דוחות" (IA §7) — the historical tab: "what happens over time, am I
 * improving?". No "right now" metric belongs here and none of these four KPIs is
 * a card on another tab (§1.1). All derive from the existing reports endpoints.
 */
export default function ReportsHubPage() {
  const { monthKey } = useMonth();
  const trendRes = useAsync(() => getTrendReport(monthKey), [monthKey], "לא הצלחנו לטעון את הדוח");
  const reportRes = useAsync(() => getMonthlyReport(monthKey), [monthKey], "לא הצלחנו לטעון את הדוח");

  return (
    <>
      <div className="kpi-row">
        <AsyncSection
          resource={trendRes}
          errorTitle="לא הצלחנו לטעון את הדוח"
          skeleton={<SkeletonCard />}
          isEmpty={(data) => activeMonths(data).length < 2}
          emptyState={
            <SummaryCard
              label="דוח 12 חודשים"
              value="—"
              certainty="unknown"
              sub="צריך לפחות חודשיים של נתונים כדי להפיק דוח"
            />
          }
        >
          {(data) => {
            const months = activeMonths(data);
            const expenseSum = months.reduce((sum, row) => sum + row.expenseTotal, 0);
            const incomeSum = months.reduce((sum, row) => sum + row.incomeTotal, 0);
            const balanceSum = months.reduce((sum, row) => sum + row.balance, 0);
            const priciest = months.reduce((max, row) => (row.expenseTotal > max.expenseTotal ? row : max), months[0]);
            const savingsRate = incomeSum > 0 ? (balanceSum / incomeSum) * 100 : null;
            return (
              <>
                <SummaryCard
                  label="ממוצע הוצאה חודשית"
                  value={formatCurrency(expenseSum / months.length)}
                  sub={`לפי ${months.length} חודשים עם נתונים`}
                />
                <SummaryCard
                  label="שיעור חיסכון"
                  value={savingsRate === null ? "—" : `${Math.round(savingsRate)}%`}
                  // No income on record means the rate is unknown, not 0% (§1.2).
                  certainty={savingsRate === null ? "unknown" : "measured"}
                  tone={savingsRate === null ? "default" : savingsRate >= 10 ? "success" : savingsRate >= 0 ? "warning" : "danger"}
                  sub={savingsRate === null ? "אין הכנסות רשומות בטווח" : "מתוך ההכנסות בטווח"}
                />
                <SummaryCard
                  label="החודש היקר ביותר"
                  value={formatCurrency(priciest.expenseTotal)}
                  sub={formatMonthKey(priciest.monthKey)}
                  tone="danger"
                />
              </>
            );
          }}
        </AsyncSection>

        <AsyncSection resource={reportRes} errorTitle="לא הצלחנו לטעון את הדוח" skeleton={<SkeletonCard />}>
          {(data) => (
            <SummaryCard
              label="שינוי בהוצאות מול חודש קודם"
              value={`${data.delta.expense > 0 ? "▲" : data.delta.expense < 0 ? "▼" : ""} ${formatCurrency(
                Math.abs(data.delta.expense)
              )}`}
              // Falling expenses are the good direction, so the tone is inverted.
              tone={data.delta.expense === 0 ? "default" : data.delta.expense < 0 ? "success" : "danger"}
              sub={`מול ${formatMonthKey(data.previousMonthKey)}`}
            />
          )}
        </AsyncSection>
      </div>

      <TabbedHub
        tabs={[
          { key: "monthly", label: "דוח חודשי", icon: "📈", element: <ReportsPage /> },
          { key: "comparison", label: "השוואת חודשים", icon: "⚖️", element: <ComparisonPage /> },
        ]}
      />
    </>
  );
}
