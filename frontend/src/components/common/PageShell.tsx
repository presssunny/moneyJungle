import type { ReactNode } from "react";

/**
 * The layout every screen shares.
 *
 * The audit found 26 screens each arranged differently: six had a KPI row, one
 * had insights, the rest opened straight onto a table. Reading one screen taught
 * you nothing about the next.
 *
 * So the order is enforced here, once, instead of being re-decided per page:
 *
 *   toolbar → hero → summary → insights → progress → timeline
 *           → charts → details → tables → actions
 *
 * Every slot is optional — a screen with no charts simply passes none — but
 * whatever it does pass lands in the same place it lands everywhere else. The
 * value is not that all screens are full; it is that they are consistent.
 *
 * Two deliberate choices:
 *  - `toolbar` stays at the TOP. The primary action ("+ הוספה") belongs where
 *    the hand reaches first; burying it under the tables to satisfy a diagram
 *    would be worse UX, not better.
 *  - `actions` at the bottom is for the secondary and the bulk: export, "apply
 *    to all", things you reach for after reading, not before.
 */
export interface PageShellProps {
  /** Primary action + page-level totals. Stays at the top. */
  toolbar?: ReactNode;
  /** The one number the screen exists to answer. */
  hero?: ReactNode;
  /** KPI row. */
  summary?: ReactNode;
  /** What the numbers mean — the slot the assistant will grow into. */
  insights?: ReactNode;
  /** Progress towards a target: budget pace, loan repayment, savings goal. */
  progress?: ReactNode;
  /** Events over time. */
  timeline?: ReactNode;
  charts?: ReactNode;
  /** Detail that is neither a chart nor a table (cards, groups, breakdowns). */
  details?: ReactNode;
  tables?: ReactNode;
  /** Secondary/bulk actions. */
  actions?: ReactNode;
  children?: ReactNode;
}

export function PageShell({
  toolbar,
  hero,
  summary,
  insights,
  progress,
  timeline,
  charts,
  details,
  tables,
  actions,
  children,
}: PageShellProps) {
  return (
    <div className="page-shell">
      {toolbar && <div className="page-shell-toolbar">{toolbar}</div>}
      {hero && <section className="page-shell-hero">{hero}</section>}
      {summary && <section className="page-shell-summary">{summary}</section>}
      {insights && <section className="page-shell-insights">{insights}</section>}
      {progress && <section className="page-shell-progress">{progress}</section>}
      {timeline && <section className="page-shell-timeline">{timeline}</section>}
      {charts && <section className="page-shell-charts">{charts}</section>}
      {details && <section className="page-shell-details">{details}</section>}
      {tables && <section className="page-shell-tables">{tables}</section>}
      {/* Anything a screen has not yet been migrated into slots renders here, in
          place, so adoption can be gradual instead of a 26-file rewrite. */}
      {children}
      {actions && <section className="page-shell-actions">{actions}</section>}
    </div>
  );
}
