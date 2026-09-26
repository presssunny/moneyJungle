/**
 * Three-level certainty language (IA §1.2): `measured` renders plain, `scenario`
 * is bracketed and labelled, `unknown` is an em dash — never 0, never a good/bad
 * colour, and always marked in text rather than by colour alone.
 */

import { certaintyAriaLabel, certaintyValue, type Certainty } from "../../utils/certainty";

export type { Certainty };

const LABEL: Record<Exclude<Certainty, "measured">, { icon: string; text: string; hint: string }> = {
  scenario: {
    icon: "≈",
    text: "תרחיש",
    hint: "מספר מחושב מהנחה או מתחזית — לא מדוח בנק",
  },
  unknown: {
    icon: "?",
    text: "לא ידוע · דורש בדיקה",
    hint: "אין מספיק נתונים כדי לחשב — לא מוצג 0 כדי לא להטעות",
  },
};

export function UncertaintyBadge({ level }: { level: Exclude<Certainty, "measured"> }) {
  const { icon, text, hint } = LABEL[level];
  return (
    <span className={`uncert-badge uncert-badge-${level}`} title={hint}>
      <span aria-hidden>{icon}</span> {text}
    </span>
  );
}

/** Inline value + badge, for table cells and free text. */
export function UncertainValue({
  level,
  formatted,
  label,
}: {
  level: Certainty;
  formatted: string;
  label: string;
}) {
  if (level === "measured") {
    return <span className="mono">{formatted}</span>;
  }
  return (
    <span className={`uncert-value uncert-value-${level}`} aria-label={certaintyAriaLabel(level, label, formatted)}>
      <span className="mono" aria-hidden>
        {certaintyValue(level, formatted)}
      </span>
      <UncertaintyBadge level={level} />
    </span>
  );
}
