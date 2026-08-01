import { useMemo, useState } from "react";
import type { CategorySlice } from "../../types/dashboard.types";
import { formatCurrency } from "../../utils/format";

const MAX_ROWS = 7;
const OTHER_COLOR = "#6D6875";

/**
 * Ranked horizontal bars of spending by category.
 * Chosen over a donut because it compares magnitudes directly, never truncates
 * long Hebrew category names, and encodes identity three ways (icon + color +
 * label) rather than by color alone. Small categories fold into "אחר".
 */
export function CategoryBarChart({ data }: { data: CategorySlice[] }) {
  const [hovered, setHovered] = useState<string | null>(null);

  const { rows, total } = useMemo(() => {
    const sorted = [...data].sort((a, b) => b.value - a.value);
    const main = sorted.slice(0, MAX_ROWS);
    const rest = sorted.slice(MAX_ROWS);
    const rows: CategorySlice[] =
      rest.length > 0
        ? [...main, { name: "אחר", color: OTHER_COLOR, value: rest.reduce((acc, s) => acc + s.value, 0) }]
        : main;
    const total = rows.reduce((acc, s) => acc + s.value, 0);
    return { rows, total };
  }, [data]);

  const max = rows.length > 0 ? rows[0].value : 0;

  return (
    <div className="cat-bars">
      {rows.map((row) => {
        const share = total > 0 ? (row.value / total) * 100 : 0;
        const width = max > 0 ? (row.value / max) * 100 : 0;
        const active = hovered === null || hovered === row.name;
        return (
          <div
            key={row.name}
            className={`cat-bar ${active ? "" : "cat-bar-dim"}`}
            onMouseEnter={() => setHovered(row.name)}
            onMouseLeave={() => setHovered(null)}
            title={`${row.name}: ${formatCurrency(row.value)} (${share.toFixed(1)}%)`}
          >
            <div className="cat-bar-head">
              {row.icon && <span className="cat-bar-icon" aria-hidden>{row.icon}</span>}
              <span className="cat-bar-name">{row.name}</span>
              <span className="cat-bar-value mono">{formatCurrency(row.value)}</span>
              <span className="cat-bar-pct">{Math.round(share)}%</span>
            </div>
            <div className="cat-bar-track">
              <div
                className="cat-bar-fill"
                style={{ width: `${width}%`, background: row.color }}
              />
            </div>
          </div>
        );
      })}
      <div className="cat-bars-total">
        <span>סה״כ</span>
        <span className="mono">{formatCurrency(total)}</span>
      </div>
    </div>
  );
}
