import { useCallback, useEffect, useState } from "react";
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
import { Card } from "../components/common/Card";
import { EmptyState } from "../components/common/EmptyState";
import { Loading } from "../components/common/Loading";
import { CategoryPieChart } from "../components/dashboard/CategoryPieChart";
import { SummaryCard } from "../components/dashboard/SummaryCard";
import { chartChrome, tooltipStyle } from "../components/dashboard/chartTheme";
import { useMonth } from "../context/MonthContext";
import { getMonthlyReport, getTrendReport } from "../services/finance.service";
import type { MonthlyReport, TrendRow } from "../types/models";
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

export default function ReportsPage() {
  const { monthKey } = useMonth();
  const [report, setReport] = useState<MonthlyReport | null>(null);
  const [trend, setTrend] = useState<TrendRow[] | null>(null);

  const load = useCallback(() => {
    getMonthlyReport(monthKey).then(setReport).catch(() => {});
    getTrendReport(monthKey).then(setTrend).catch(() => {});
  }, [monthKey]);

  useEffect(load, [load]);

  if (!report) return <Loading />;

  const chrome = chartChrome();

  return (
    <>
      <div className="summary-grid">
        <SummaryCard label="הכנסות" value={formatCurrency(report.current.incomeTotal)} tone="success" sub={undefined} />
        <SummaryCard label="הוצאות" value={formatCurrency(report.current.expenseTotal)} tone="danger" />
        <SummaryCard
          label="מאזן"
          value={formatCurrency(report.current.balance)}
          tone={report.current.balance >= 0 ? "primary" : "danger"}
        />
      </div>

      <div className="delta-row">
        <span>הכנסות: <DeltaBadge value={report.delta.income} /></span>
        <span>הוצאות: <DeltaBadge value={report.delta.expense} invert /></span>
        <span>מאזן: <DeltaBadge value={report.delta.balance} /></span>
      </div>

      <div className="charts-grid">
        <Card title="הוצאה מצטברת לאורך החודש">
          {report.dailySpending.some((d) => d.cumulative > 0) ? (
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
          ) : (
            <EmptyState icon="📈" title="אין הוצאות החודש" />
          )}
        </Card>

        <Card title="הוצאות לפי קטגוריה">
          {report.byCategory.length > 0 ? (
            <CategoryPieChart data={report.byCategory} />
          ) : (
            <EmptyState icon="🥧" title="אין הוצאות מסווגות" />
          )}
        </Card>

        <Card title="הכנסות לפי סוג">
          {report.incomeByType.length > 0 ? (
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
          ) : (
            <EmptyState icon="💰" title="אין הכנסות החודש" />
          )}
        </Card>

        <Card title="מגמה שנתית — 12 חודשים">
          {trend && trend.some((t) => t.incomeTotal > 0 || t.expenseTotal > 0) ? (
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
          ) : (
            <EmptyState icon="📊" title="אין עדיין נתונים למגמה" />
          )}
        </Card>
      </div>
    </>
  );
}
