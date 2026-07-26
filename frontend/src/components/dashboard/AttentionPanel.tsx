import { Link } from "react-router-dom";
import { Card } from "../common/Card";

export interface AttentionItem {
  id: string;
  icon: string;
  text: string;
  to: string;
  tone: "info" | "warning" | "critical";
}

/**
 * "מוקדי תשומת לב" (IA §3.3) — replaces the KPI cards that moved to their own
 * tabs. Each line is a sentence plus a link to the tab that can resolve it, so
 * the home tab answers "what needs me?" instead of repeating numbers that are
 * already shown elsewhere (rule §1.1).
 */
export function AttentionPanel({ items }: { items: AttentionItem[] }) {
  if (items.length === 0) return null;

  return (
    <Card title="מוקדי תשומת לב">
      <ul className="attention-list">
        {items.slice(0, 4).map((item) => (
          <li key={item.id}>
            <Link to={item.to} className={`attention-item attention-${item.tone}`}>
              <span className="attention-icon" aria-hidden>
                {item.icon}
              </span>
              <span className="attention-text">{item.text}</span>
              <span className="attention-go" aria-hidden>
                ←
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
