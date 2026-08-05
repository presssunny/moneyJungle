import { Bar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { BudgetItem } from "../../types/models";
import { formatCurrency } from "../../utils/format";
import { chartChrome, tooltipStyle } from "./chartTheme";

/**
 * Grouped "planned vs actual" bars per category (IA §5.2). Side by side, not
 * stacked: the budget question is about the GAP, and stacking would read as
 * planned+actual summed. Data comes straight from `GET /budgets?month`.
 */
export function BudgetVsActualChart({ budgets }: { budgets: BudgetItem[] }) {
  const chrome = chartChrome();

  const rows = [...budgets]
    .sort((a, b) => b.amount - a.amount)
    .map((budget) => ({
      name: `${budget.category.icon ?? ""} ${budget.category.name}`.trim(),
      planned: budget.amount,
      actual: budget.spent,
      over: budget.spent > budget.amount,
    }));

  const overrun = rows.filter((row) => row.over);
  const summary =
    overrun.length > 0
      ? `תקציב מול הוצאה בפועל לפי קטגוריה; ${overrun.length} קטגוריות בחריגה: ${overrun
          .map((row) => row.name)
          .join(", ")}`
      : "תקציב מול הוצאה בפועל לפי קטגוריה; אין חריגות";

  return (
    <div role="img" aria-label={summary}>
      <ResponsiveContainer width="100%" height={Math.max(240, rows.length * 46)}>
        <BarChart data={rows} layout="vertical" margin={{ top: 8, right: 12, left: 12, bottom: 0 }}>
          <CartesianGrid stroke={chrome.grid} strokeDasharray="3 6" horizontal={false} />
          <XAxis
            type="number"
            tick={{ fill: chrome.text, fontSize: 11, fontFamily: "JetBrains Mono" }}
            tickFormatter={(v: number) => `₪${(v / 1000).toFixed(0)}K`}
            axisLine={false}
            tickLine={false}
            reversed
          />
          <YAxis
            type="category"
            dataKey="name"
            tick={{ fill: chrome.text, fontSize: 12 }}
            axisLine={{ stroke: chrome.grid }}
            tickLine={false}
            orientation="right"
            width={130}
          />
          <Tooltip
            contentStyle={tooltipStyle()}
            cursor={{ fill: chrome.grid, fillOpacity: 0.15 }}
            formatter={(value, name) => [formatCurrency(Number(value)), name === "planned" ? "מתוכנן" : "בפועל"]}
          />
          <Legend
            formatter={(value) => (value === "planned" ? "מתוכנן" : "בפועל")}
            wrapperStyle={{ fontSize: 12, color: chrome.text }}
          />
          <Bar dataKey="planned" fill={chrome.secondary} radius={[0, 5, 5, 0]} maxBarSize={14} />
          <Bar dataKey="actual" radius={[0, 5, 5, 0]} maxBarSize={14}>
            {/* Overrun is coloured *and* named in the aria summary — colour is never the only signal (§8.4). */}
            {rows.map((row) => (
              <Cell key={row.name} fill={row.over ? chrome.danger : chrome.success} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
