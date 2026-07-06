import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { LoanSplit } from "../../types/dashboard.types";
import { formatCurrency } from "../../utils/format";
import { chartChrome, tooltipStyle } from "./chartTheme";

/** Interest vs principal per loan (stacked). */
export function LoanSplitChart({ data }: { data: LoanSplit[] }) {
  const chrome = chartChrome();
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ top: 8, right: 12, left: 12, bottom: 0 }} barSize={26}>
        <CartesianGrid stroke={chrome.grid} strokeDasharray="3 6" vertical={false} />
        <XAxis dataKey="name" tick={{ fill: chrome.text, fontSize: 12 }} axisLine={{ stroke: chrome.grid }} tickLine={false} reversed />
        <YAxis
          tick={{ fill: chrome.text, fontSize: 11, fontFamily: "JetBrains Mono" }}
          tickFormatter={(v: number) => `₪${v.toLocaleString()}`}
          axisLine={false}
          tickLine={false}
          orientation="right"
          width={70}
        />
        <Tooltip
          contentStyle={tooltipStyle()}
          formatter={(value, name) => [formatCurrency(Number(value)), name === "principal" ? "קרן" : "ריבית"]}
          cursor={{ fill: "rgba(255,255,255,0.04)" }}
        />
        <Legend formatter={(value) => (value === "principal" ? "קרן" : "ריבית")} />
        <Bar dataKey="principal" stackId="a" fill={chrome.secondary} radius={[0, 0, 0, 0]} />
        <Bar dataKey="interest" stackId="a" fill={chrome.danger} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
