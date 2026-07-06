import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import type { CategorySlice } from "../../types/dashboard.types";
import { formatCurrency } from "../../utils/format";
import { chartChrome, tooltipStyle } from "./chartTheme";

const MAX_SLICES = 7;

/** Donut of spending by category; small categories fold into "אחר". */
export function CategoryPieChart({ data }: { data: CategorySlice[] }) {
  const chrome = chartChrome();
  const main = data.slice(0, MAX_SLICES);
  const rest = data.slice(MAX_SLICES);
  const slices =
    rest.length > 0
      ? [...main, { name: "אחר", color: "#6D6875", value: rest.reduce((acc, s) => acc + s.value, 0) }]
      : main;
  const total = slices.reduce((acc, s) => acc + s.value, 0);

  return (
    <div className="pie-layout">
      <ResponsiveContainer width="50%" height={230}>
        <PieChart>
          <Pie
            data={slices}
            dataKey="value"
            nameKey="name"
            innerRadius="55%"
            outerRadius="85%"
            paddingAngle={2}
            stroke={chrome.card}
            strokeWidth={2}
          >
            {slices.map((slice) => (
              <Cell key={slice.name} fill={slice.color} />
            ))}
          </Pie>
          <Tooltip contentStyle={tooltipStyle()} formatter={(value) => formatCurrency(Number(value))} />
        </PieChart>
      </ResponsiveContainer>
      <ul className="pie-legend">
        {slices.map((slice) => (
          <li key={slice.name}>
            <span className="pie-legend-dot" style={{ background: slice.color }} />
            <span className="pie-legend-name">{slice.name}</span>
            <span className="pie-legend-value mono">
              {total > 0 ? Math.round((slice.value / total) * 100) : 0}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
