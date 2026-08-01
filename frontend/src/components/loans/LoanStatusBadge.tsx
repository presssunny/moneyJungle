import type { LoanLifecycle } from "../../types/models";

/**
 * A loan's state at a glance.
 *
 * Colour is never the only signal (IA §8.4): every badge carries an icon AND a
 * word, so it reads the same for a colour-blind user and for a screen reader.
 */
const BADGE: Record<LoanLifecycle, { icon: string; label: string; tone: string }> = {
  active: { icon: "🟢", label: "פעילה", tone: "success" },
  ending_soon: { icon: "🟠", label: "לקראת סיום", tone: "warning" },
  closed: { icon: "⚫", label: "נסגרה", tone: "muted" },
  overdue: { icon: "🔴", label: "בפיגור", tone: "danger" },
};

export function LoanStatusBadge({ lifecycle, closedAt }: { lifecycle: LoanLifecycle; closedAt?: string | null }) {
  const { icon, label, tone } = BADGE[lifecycle];
  const date = lifecycle === "closed" && closedAt ? new Date(closedAt).toLocaleDateString("he-IL") : null;
  return (
    <span className={`loan-badge loan-badge-${tone}`}>
      <span aria-hidden>{icon}</span>
      {label}
      {date && <span className="loan-badge-date">{date}</span>}
    </span>
  );
}
