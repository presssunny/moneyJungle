import { useCallback, useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card } from "../components/common/Card";
import { EmptyState } from "../components/common/EmptyState";
import { Loading } from "../components/common/Loading";
import { chartChrome, tooltipStyle } from "../components/dashboard/chartTheme";
import { useMonth } from "../context/MonthContext";
import { getMonthlyReport, getTrendReport } from "../services/finance.service";
import type { MonthlyReport, TrendRow } from "../types/models";
import { formatCurrency, formatMonthKey } from "../utils/format";

function DeltaCell({ value, invert = false }: { value: number; invert?: boolean }) {
  if (value === 0) return <span className="text-muted">—</span>;
  const good = invert ? value < 0 : value > 0;
  return (
    <span className={`mono ${good ? "text-success" : "text-danger"}`}>
      {value > 0 ? "+" : "-"}{formatCurrency(Math.abs(value))}
    </span>
  );
}

export default function ComparisonPage() {
  const { monthKey } = useMonth();
  const [report, setReport] = useState<MonthlyReport | null>(null);
  const [trend, setTrend] = useState<TrendRow[] | null>(null);

  const load = useCallback(() => {
    getMonthlyReport(monthKey).then(setReport).catch(() => {});
    getTrendReport(monthKey).then(setTrend).catch(() => setTrend([]));
  }, [monthKey]);

  useEffect(load, [load]);

  if (!report || !trend) return <Loading />;

  const chrome = chartChrome();
  const pair = [
    { label: formatMonthKey(report.previousMonthKey), income: report.previous.incomeTotal, expense: report.previous.expenseTotal },
    { label: formatMonthKey(report.monthKey), income: report.current.incomeTotal, expense: report.current.expenseTotal },
  ];

  return (
    <>
      <Card title={`${formatMonthKey(report.monthKey)} מול ${formatMonthKey(report.previousMonthKey)}`}>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th style={{ textAlign: "right" }}></th>
                <th style={{ textAlign: "left" }}>{formatMonthKey(report.monthKey)}</th>
                <th style={{ textAlign: "left" }}>{formatMonthKey(report.previousMonthKey)}</th>
                <th style={{ textAlign: "left" }}>שינוי</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>הכנסות</td>
                <td style={{ textAlign: "left" }} className="mono text-success">{formatCurrency(report.current.incomeTotal)}</td>
                <td style={{ textAlign: "left" }} className="mono">{formatCurrency(report.previous.incomeTotal)}</td>
                <td style={{ textAlign: "left" }}><DeltaCell value={report.delta.income} /></td>
              </tr>
              <tr>
                <td>הוצאות</td>
                <td style={{ textAlign: "left" }} className="mono text-danger">{formatCurrency(report.current.expenseTotal)}</td>
                <td style={{ textAlign: "left" }} className="mono">{formatCurrency(report.previous.expenseTotal)}</td>
                <td style={{ textAlign: "left" }}><DeltaCell value={report.delta.expense} invert /></td>
              </tr>
              <tr>
                <td>מאזן</td>
                <td style={{ textAlign: "left" }} className="mono">{formatCurrency(report.current.balance)}</td>
                <td style={{ textAlign: "left" }} className="mono">{formatCurrency(report.previous.balance)}</td>
                <td style={{ textAlign: "left" }}><DeltaCell value={report.delta.balance} /></td>
              </tr>
            </tbody>
          </table>
        </div>

        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={pair} margin={{ top: 16, right: 12, left: 12, bottom: 0 }}>
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
            <Tooltip
              contentStyle={tooltipStyle()}
              formatter={(value, name) => [formatCurrency(Number(value)), name === "income" ? "הכנסות" : "הוצאות"]}
            />
            <Bar dataKey="income" fill={chrome.success} radius={[6, 6, 0, 0]} maxBarSize={48} />
            <Bar dataKey="expense" fill={chrome.danger} radius={[6, 6, 0, 0]} maxBarSize={48} />
          </BarChart>
        </ResponsiveContainer>
      </Card>

      <Card title="12 חודשים אחרונים">
        {trend.some((t) => t.incomeTotal > 0 || t.expenseTotal > 0) ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ textAlign: "right" }}>חודש</th>
                  <th style={{ textAlign: "left" }}>הכנסות</th>
                  <th style={{ textAlign: "left" }}>הוצאות</th>
                  <th style={{ textAlign: "left" }}>מאזן</th>
                </tr>
              </thead>
              <tbody>
                {[...trend].reverse().map((row) => (
                  <tr key={row.monthKey}>
                    <td>{formatMonthKey(row.monthKey)}</td>
                    <td style={{ textAlign: "left" }} className="mono text-success">{formatCurrency(row.incomeTotal)}</td>
                    <td style={{ textAlign: "left" }} className="mono text-danger">{formatCurrency(row.expenseTotal)}</td>
                    <td style={{ textAlign: "left" }} className={`mono ${row.balance < 0 ? "text-danger" : ""}`}>
                      {formatCurrency(row.balance)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon="⚖️" title="אין עדיין נתונים להשוואה" />
        )}
      </Card>
    </>
  );
}
