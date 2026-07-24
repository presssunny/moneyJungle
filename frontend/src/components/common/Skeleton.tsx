/**
 * Loading placeholders that keep the page layout stable while data arrives
 * (IA §3.5 / §8.4: skeletons, not a spinner — a spinner hides the structure and
 * makes a slow load feel like a broken page).
 *
 * The shapes are decorative (`aria-hidden`); a single polite status message per
 * block carries the meaning for screen readers.
 */

import type { CSSProperties } from "react";

function SkeletonBlock({ className = "", style }: { className?: string; style?: CSSProperties }) {
  return <div className={`skeleton ${className}`} style={style} aria-hidden />;
}

function Announce({ label }: { label: string }) {
  return (
    <span className="sr-only" role="status" aria-live="polite">
      {label}
    </span>
  );
}

/** A single KPI-card placeholder. */
export function SkeletonCard() {
  return (
    <div className="skeleton-card" aria-hidden>
      <SkeletonBlock className="skeleton-line skeleton-line-sm" />
      <SkeletonBlock className="skeleton-line skeleton-line-lg" />
      <SkeletonBlock className="skeleton-line skeleton-line-xs" />
    </div>
  );
}

/** A row of KPI-card placeholders (defaults to the standard 4-metric row). */
export function SkeletonKpiRow({ count = 4, label = "טוען נתונים" }: { count?: number; label?: string }) {
  return (
    <div className="kpi-row">
      <Announce label={label} />
      {Array.from({ length: count }, (_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}

/** Chart-area placeholder. Height matches the real chart so nothing jumps. */
export function SkeletonChart({ height = 240, label = "טוען גרף" }: { height?: number; label?: string }) {
  return (
    <div className="skeleton-chart" style={{ height }}>
      <Announce label={label} />
      <SkeletonBlock className="skeleton-bar" style={{ height: "45%" }} />
      <SkeletonBlock className="skeleton-bar" style={{ height: "80%" }} />
      <SkeletonBlock className="skeleton-bar" style={{ height: "60%" }} />
      <SkeletonBlock className="skeleton-bar" style={{ height: "92%" }} />
      <SkeletonBlock className="skeleton-bar" style={{ height: "35%" }} />
      <SkeletonBlock className="skeleton-bar" style={{ height: "70%" }} />
    </div>
  );
}

/** Table-row placeholders. */
export function SkeletonRows({ rows = 5, label = "טוען שורות" }: { rows?: number; label?: string }) {
  return (
    <div className="skeleton-rows">
      <Announce label={label} />
      {Array.from({ length: rows }, (_, i) => (
        <SkeletonBlock key={i} className="skeleton-row" />
      ))}
    </div>
  );
}
