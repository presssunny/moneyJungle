import { Link } from "react-router-dom";
import type { AttentionItem } from "../../types/models";
import { Card } from "../common/Card";

/**
 * "מוקדי תשומת לב" (IA §3.3) — each line is a sentence plus a link to the tab
 * that resolves it. Arrives already merged and deduped from GET
 * /dashboard/attention; this component only renders.
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
