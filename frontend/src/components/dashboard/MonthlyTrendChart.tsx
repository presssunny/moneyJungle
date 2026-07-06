import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { TrendPoint } from "../../types/dashboard.types";
import { formatCurrency, formatMonthKey } from "../../utils/format";
import { chartChrome, tooltipStyle } from "./chartTheme";

export function MonthlyTrendChart({ data }: { data: TrendPoint[] }) {
  const chrome = chartChrome();
  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={data} margin={{ top: 8, right: 12, left: 12, bottom: 0 }}>
        <CartesianGrid stroke={chrome.grid} strokeDasharray="3 6" vertical={false} />
        <XAxis
          dataKey="monthKey"
          tickFormatter={(key: string) => formatMonthKey(key).split(" ")[0]}
          tick={{ fill: chrome.text, fontSize: 12 }}
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
          formatter={(value, name) => [formatCurrency(Number(value)), name === "income" ? "הכנסות" : "הוצאות"]}
          labelFormatter={(key) => formatMonthKey(String(key))}
        />
        <Legend formatter={(value) => (value === "income" ? "הכנסות" : "הוצאות")} />
        <Line type="monotone" dataKey="income" stroke={chrome.success} strokeWidth={2} dot={{ r: 3 }} />
        <Line type="monotone" dataKey="expense" stroke={chrome.danger} strokeWidth={2} dot={{ r: 3 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}
