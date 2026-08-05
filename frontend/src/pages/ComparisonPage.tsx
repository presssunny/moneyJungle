import { useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AsyncSection } from "../components/common/AsyncSection";
import { PageShell } from "../components/common/PageShell";
import { Button } from "../components/common/Button";
import { Card } from "../components/common/Card";
import { EmptyState } from "../components/common/EmptyState";
import { SkeletonChart, SkeletonRows } from "../components/common/Skeleton";
import { UNKNOWN_PLACEHOLDER } from "../components/common/UncertaintyBadge";
import { chartChrome, tooltipStyle } from "../components/dashboard/chartTheme";
import { useMonth } from "../context/MonthContext";
import { useAsync } from "../hooks/useAsync";
import { getMonthlyReport, getTrendReport } from "../services/finance.service";
import type { TrendRow } from "../types/models";
import { formatCurrency, formatMonthKey } from "../utils/format";

type SortKey = "monthKey" | "incomeTotal" | "expenseTotal" | "balance";

function DeltaCell({ value, invert = false }: { value: number; invert?: boolean }) {
  if (value === 0) return <span className="text-muted">{UNKNOWN_PLACEHOLDER}</span>;
  const good = invert ? value < 0 : value > 0;
  return (
    <span className={`mono ${good ? "text-success" : "text-danger"}`}>
      {value > 0 ? "+" : "-"}{formatCurrency(Math.abs(value))}
    </span>
  );
}

/** Savings rate for a month. No income on record ⇒ unknown, not 0% (IA §1.2). */
function savingsRate(row: TrendRow): number | null {
  return row.incomeTotal > 0 ? (row.balance / row.incomeTotal) * 100 : null;
}

/** Month comparison (sub-tab of טאב "דוחות"). */
export default function ComparisonPage() {
  const { monthKey } = useMonth();
  const reportRes = useAsync(() => getMonthlyReport(monthKey), [monthKey], "לא הצלחנו לטעון את ההשוואה");
  const trendRes = useAsync(() => getTrendReport(monthKey), [monthKey], "לא הצלחנו לטעון את ההשוואה");
  // The trend endpoint returns 12 months; 24 needs an API change (IA §9.2), so
  // it is not offered rather than silently showing 12 under a "24" label.
  const [months, setMonths] = useState<6 | 12>(12);
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "monthKey", desc: true });

  const chrome = chartChrome();

  function toggleSort(key: SortKey) {
    setSort((prev) => (prev.key === key ? { key, desc: !prev.desc } : { key, desc: true }));
  }

  const sortIndicator = (key: SortKey) => (sort.key === key ? (sort.desc ? " ▼" : " ▲") : "");

  return (
    <PageShell>
      <AsyncSection
        resource={reportRes}
        errorTitle="לא הצלחנו לטעון את ההשוואה"
        skeleton={<SkeletonChart height={300} label="טוען השוואה" />}
      >
        {(report) => {
          const pair = [
            {
              label: formatMonthKey(report.previousMonthKey),
              income: report.previous.incomeTotal,
              expense: report.previous.expenseTotal,
            },
            {
              label: formatMonthKey(report.monthKey),
              income: report.current.incomeTotal,
              expense: report.current.expenseTotal,
            },
          ];
          return (
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
          );
        }}
      </AsyncSection>

      <Card
        title={`${months} חודשים אחרונים`}
        action={
          <span className="row-actions">
            <Button size="sm" variant={months === 6 ? "primary" : "ghost"} onClick={() => setMonths(6)}>
              6 חודשים
            </Button>
            <Button size="sm" variant={months === 12 ? "primary" : "ghost"} onClick={() => setMonths(12)}>
              12 חודשים
            </Button>
          </span>
        }
      >
        <AsyncSection
          resource={trendRes}
          errorTitle="לא הצלחנו לטעון את ההשוואה"
          skeleton={<SkeletonRows rows={6} />}
          isEmpty={(trend) => !trend.some((t) => t.incomeTotal > 0 || t.expenseTotal > 0)}
          emptyState={
            <EmptyState icon="⚖️" title="אין עדיין נתונים להשוואה" hint="נחזור לכאן אחרי חודש נוסף של מעקב" />
          }
        >
          {(trend) => {
            const rangeRows = trend.slice(-months);
            const sorted = [...rangeRows].sort((a, b) => {
              const dir = sort.desc ? -1 : 1;
              if (sort.key === "monthKey") return a.monthKey.localeCompare(b.monthKey) * dir;
              return (a[sort.key] - b[sort.key]) * dir;
            });
            return (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th style={{ textAlign: "right" }}>
                        <button type="button" className="linklike" onClick={() => toggleSort("monthKey")}>
                          חודש{sortIndicator("monthKey")}
                        </button>
                      </th>
                      <th style={{ textAlign: "left" }}>
                        <button type="button" className="linklike" onClick={() => toggleSort("incomeTotal")}>
                          הכנסות{sortIndicator("incomeTotal")}
                        </button>
                      </th>
                      <th style={{ textAlign: "left" }}>
                        <button type="button" className="linklike" onClick={() => toggleSort("expenseTotal")}>
                          הוצאות{sortIndicator("expenseTotal")}
                        </button>
                      </th>
                      <th style={{ textAlign: "left" }}>
                        <button type="button" className="linklike" onClick={() => toggleSort("balance")}>
                          מאזן{sortIndicator("balance")}
                        </button>
                      </th>
                      <th style={{ textAlign: "left" }}>שיעור חיסכון</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((row) => {
                      const rate = savingsRate(row);
                      return (
                        <tr key={row.monthKey}>
                          <td>{formatMonthKey(row.monthKey)}</td>
                          <td style={{ textAlign: "left" }} className="mono text-success">{formatCurrency(row.incomeTotal)}</td>
                          <td style={{ textAlign: "left" }} className="mono text-danger">{formatCurrency(row.expenseTotal)}</td>
                          <td style={{ textAlign: "left" }} className={`mono ${row.balance < 0 ? "text-danger" : ""}`}>
                            {formatCurrency(row.balance)}
                          </td>
                          <td style={{ textAlign: "left" }} className="mono">
                            {rate === null ? (
                              <span className="text-muted" title="אין הכנסות רשומות בחודש זה">{UNKNOWN_PLACEHOLDER}</span>
                            ) : (
                              `${Math.round(rate)}%`
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          }}
        </AsyncSection>
      </Card>
    </PageShell>
  );
}
