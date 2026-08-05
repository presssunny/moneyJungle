import type { ReactNode } from "react";

/**
 * The slot order every screen shares, enforced once instead of re-decided per
 * page. Slots are optional; what a page does pass lands where it lands elsewhere.
 *
 * `toolbar` stays on top (the primary action belongs where the hand reaches
 * first); `actions` at the bottom is for the secondary and the bulk.
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
