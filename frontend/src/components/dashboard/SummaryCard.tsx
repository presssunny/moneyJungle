import {
  certaintyAriaLabel,
  certaintyValue,
  UncertaintyBadge,
  type Certainty,
} from "../common/UncertaintyBadge";

interface SummaryCardProps {
  label: string;
  value: string;
  tone?: "default" | "success" | "danger" | "warning" | "primary";
  sub?: string;
  size?: "default" | "hero";
  /** Visually emphasise this card (used for the "safe to spend today" headline metric). */
  accent?: boolean;
  icon?: string;
  /**
   * How sure we are of `value` (IA §1.2). "scenario" brackets the number and
   * drops its colour; "unknown" replaces it with "—" — never with 0, and never
   * in green/red, because unknown is neither good nor bad.
   */
  certainty?: Certainty;
  /** Turns the card into a button — used by KPIs that apply a filter on click. */
  onClick?: () => void;
  /** Extra line under the value, e.g. "3 חודשים דורשים בדיקה". */
  footnote?: string;
}

export function SummaryCard({
  label,
  value,
  tone = "default",
  sub,
  size = "default",
  accent,
  icon,
  certainty = "measured",
  onClick,
  footnote,
}: SummaryCardProps) {
  // An uncertain number must not carry a good/bad colour signal.
  const effectiveTone = certainty === "measured" ? tone : "default";
  const shownValue = certaintyValue(certainty, value);

  const classes = [
    "summary-card",
    size === "hero" ? "summary-card-hero" : "",
    accent ? "summary-card-accent" : "",
    certainty === "unknown" ? "state-unknown" : "",
    certainty === "scenario" ? "state-scenario" : "",
    onClick ? "summary-card-clickable" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const body = (
    <>
      <div className="summary-card-label">
        {icon && <span aria-hidden>{icon} </span>}
        {label}
      </div>
      <div
        className={`summary-card-value mono tone-${effectiveTone}`}
        aria-label={certaintyAriaLabel(certainty, label, value)}
      >
        {shownValue}
      </div>
      {certainty !== "measured" && <UncertaintyBadge level={certainty} />}
      {sub && <div className="summary-card-sub">{sub}</div>}
      {footnote && <div className="summary-card-footnote">{footnote}</div>}
    </>
  );

  if (onClick) {
    return (
      <button type="button" className={classes} onClick={onClick}>
        {body}
      </button>
    );
  }
  return <div className={classes}>{body}</div>;
}
