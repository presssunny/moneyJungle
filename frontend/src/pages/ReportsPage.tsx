import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AsyncSection } from "../components/common/AsyncSection";
import { Card } from "../components/common/Card";
import { EmptyState } from "../components/common/EmptyState";
import { SkeletonChart } from "../components/common/Skeleton";
import { CategoryPieChart } from "../components/dashboard/CategoryPieChart";
import { chartChrome, tooltipStyle } from "../components/dashboard/chartTheme";
import { useMonth } from "../context/MonthContext";
import { useAsync } from "../hooks/useAsync";
import { getMonthlyReport, getTrendReport } from "../services/finance.service";
import { formatCurrency, formatMonthKey } from "../utils/format";

function DeltaBadge({ value, invert = false }: { value: number; invert?: boolean }) {
  if (value === 0) return <span className="text-muted">ללא שינוי</span>;
  const good = invert ? value < 0 : value > 0;
  return (
    <span className={good ? "text-success" : "text-danger"}>
      {value > 0 ? "▲" : "▼"} {formatCurrency(Math.abs(value))} מול חודש קודם
    </span>
  );
}

/**
 * Monthly report (sub-tab of טאב "דוחות"). No הכנסות/הוצאות/מאזן cards — those
 * are other tabs' KPIs and appear here only in the delta row and comparison
 * table (§1.1). Each chart owns its loading, empty and error state (§1.3).
 */
export default function ReportsPage() {
  const { monthKey } = useMonth();
  const reportRes = useAsync(() => getMonthlyReport(monthKey), [monthKey], "לא הצלחנו לטעון את הדוח");
  const trendRes = useAsync(() => getTrendReport(monthKey), [monthKey], "לא הצלחנו לטעון את המגמה");

  const chrome = chartChrome();

  return (
    <>
      <AsyncSection
        resource={reportRes}
        errorTitle="לא הצלחנו לטעון את הדוח"
        skeleton={<SkeletonChart height={60} label="טוען דוח חודשי" />}
      >
        {(report) => (
          <div className="delta-row">
            <span>הכנסות: <DeltaBadge value={report.delta.income} /></span>
            <span>הוצאות: <DeltaBadge value={report.delta.expense} invert /></span>
            <span>מאזן: <DeltaBadge value={report.delta.balance} /></span>
          </div>
        )}
      </AsyncSection>

      <div className="charts-grid">
        <Card title="הוצאה מצטברת לאורך החודש">
          <AsyncSection
            resource={reportRes}
            errorTitle="לא הצלחנו לטעון את הגרף"
            skeleton={<SkeletonChart />}
            isEmpty={(report) => !report.dailySpending.some((d) => d.cumulative > 0)}
            emptyState={<EmptyState icon="📈" title="אין הוצאות בחודש הזה" />}
          >
            {(report) => (
              <ResponsiveContainer width="100%" height={240}>
                <AreaChart data={report.dailySpending} margin={{ top: 8, right: 12, left: 12, bottom: 0 }}>
                  <CartesianGrid stroke={chrome.grid} strokeDasharray="3 6" vertical={false} />
                  <XAxis dataKey="day" tick={{ fill: chrome.text, fontSize: 11 }} axisLine={{ stroke: chrome.grid }} tickLine={false} reversed />
                  <YAxis
                    tick={{ fill: chrome.text, fontSize: 11, fontFamily: "JetBrains Mono" }}
                    tickFormatter={(v: number) => `₪${(v / 1000).toFixed(0)}K`}
                    axisLine={false}
                    tickLine={false}
                    orientation="right"
                    width={55}
                  />
                  <Tooltip
                    contentStyle={tooltipStyle()}
                    formatter={(value, name) => [formatCurrency(Number(value)), name === "cumulative" ? "מצטבר" : "יומי"]}
                    labelFormatter={(day) => `יום ${day}`}
                  />
                  <Area type="monotone" dataKey="cumulative" stroke={chrome.danger} fill={chrome.danger} fillOpacity={0.15} strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </AsyncSection>
        </Card>

        <Card title="הוצאות לפי קטגוריה">
          <AsyncSection
            resource={reportRes}
            errorTitle="לא הצלחנו לטעון את הגרף"
            skeleton={<SkeletonChart />}
            isEmpty={(report) => report.byCategory.length === 0}
            emptyState={<EmptyState icon="🥧" title="אין הוצאות מסווגות בחודש הזה" />}
          >
            {(report) => <CategoryPieChart data={report.byCategory} />}
          </AsyncSection>
        </Card>

        <Card title="הכנסות לפי סוג">
          <AsyncSection
            resource={reportRes}
            errorTitle="לא הצלחנו לטעון את הגרף"
            skeleton={<SkeletonChart />}
            isEmpty={(report) => report.incomeByType.length === 0}
            emptyState={<EmptyState icon="💰" title="אין הכנסות בחודש הזה" />}
          >
            {(report) => (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={report.incomeByType} margin={{ top: 8, right: 12, left: 12, bottom: 0 }}>
                  <CartesianGrid stroke={chrome.grid} strokeDasharray="3 6" vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: chrome.text, fontSize: 12 }} axisLine={{ stroke: chrome.grid }} tickLine={false} reversed />
                  <YAxis
                    tick={{ fill: chrome.text, fontSize: 11, fontFamily: "JetBrains Mono" }}
                    tickFormatter={(v: number) => `₪${(v / 1000).toFixed(0)}K`}
                    axisLine={false}
                    tickLine={false}
                    orientation="right"
                    width={55}
                  />
                  <Tooltip contentStyle={tooltipStyle()} formatter={(value) => [formatCurrency(Number(value)), "סכום"]} />
                  <Bar dataKey="value" fill={chrome.success} radius={[6, 6, 0, 0]} maxBarSize={48} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </AsyncSection>
        </Card>

        <Card title="מגמה שנתית — 12 חודשים">
          <AsyncSection
            resource={trendRes}
            errorTitle="לא הצלחנו לטעון את המגמה"
            skeleton={<SkeletonChart />}
            isEmpty={(trend) => !trend.some((t) => t.incomeTotal > 0 || t.expenseTotal > 0)}
            emptyState={<EmptyState icon="📊" title="אין עדיין נתונים למגמה" hint="נחזור לכאן אחרי חודש נוסף של מעקב" />}
          >
            {(trend) => (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={trend} margin={{ top: 8, right: 12, left: 12, bottom: 0 }}>
                  <CartesianGrid stroke={chrome.grid} strokeDasharray="3 6" vertical={false} />
                  <XAxis
                    dataKey="monthKey"
                    tickFormatter={(key: string) => formatMonthKey(key).split(" ")[0]}
                    tick={{ fill: chrome.text, fontSize: 11 }}
                    axisLine={{ stroke: chrome.grid }}
                    tickLine={false}
                    reversed
                  />
                  <YAxis
                    tick={{ fill: chrome.text, fontSize: 11, fontFamily: "JetBrains Mono" }}
                    tickFormatter={(v: number) => `₪${(v / 1000).toFixed(0)}K`}
                    axisLine={false}
                    tickLine={false}
                    orientation="right"
                    width={55}
                  />
                  <Tooltip
                    contentStyle={tooltipStyle()}
                    formatter={(value, name) => [formatCurrency(Number(value)), name === "incomeTotal" ? "הכנסות" : "הוצאות"]}
                    labelFormatter={(key) => formatMonthKey(String(key))}
                  />
                  <Bar dataKey="incomeTotal" fill={chrome.success} radius={[6, 6, 0, 0]} maxBarSize={22} />
                  <Bar dataKey="expenseTotal" fill={chrome.danger} radius={[6, 6, 0, 0]} maxBarSize={22} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </AsyncSection>
        </Card>
      </div>
    </>
  );
}
