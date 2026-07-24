/**
 * Three-level certainty language (IA §1.2), from the explicit product rule:
 * **"שום מספר לא מוצג כוודאי אם הוא נשען על הנחה."**
 *
 * | level      | when                                          | display                       |
 * |------------|-----------------------------------------------|-------------------------------|
 * | `measured` | came from a bank/credit report or a saved row | plain number, no marking      |
 * | `scenario` | derived from a forecast / amortisation table  | number in brackets + "תרחיש"  |
 * | `unknown`  | data missing, or the condition isn't resolved | "—" + "לא ידוע · דורש בדיקה" |
 *
 * Hard rules enforced here so no caller can break them:
 *  - `unknown` NEVER renders as 0 — it renders as an em dash.
 *  - `unknown` NEVER gets a good/bad colour; it is neither, it is absent.
 *  - the marking is TEXT, not only an icon or a colour (colour-blindness + SR).
 */

export type Certainty = "measured" | "scenario" | "unknown";

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

/** The em dash shown instead of a number that we do not actually know. */
export const UNKNOWN_PLACEHOLDER = "—";

export function UncertaintyBadge({ level }: { level: Exclude<Certainty, "measured"> }) {
  const { icon, text, hint } = LABEL[level];
  return (
    <span className={`uncert-badge uncert-badge-${level}`} title={hint}>
      <span aria-hidden>{icon}</span> {text}
    </span>
  );
}

/** Value text for a given certainty: brackets for a scenario, an em dash for unknown. */
export function certaintyValue(level: Certainty, formatted: string): string {
  if (level === "unknown") return UNKNOWN_PLACEHOLDER;
  if (level === "scenario") return `(${formatted})`;
  return formatted;
}

/** Spoken label for a value at a given certainty (IA §1.2 accessibility column). */
export function certaintyAriaLabel(level: Certainty, label: string, formatted: string): string {
  if (level === "unknown") return `${label}: לא ידוע, דורש בדיקה`;
  if (level === "scenario") return `${label}: ${formatted}, תרחיש — לא מדוח הבנק`;
  return `${label}: ${formatted}`;
}

/**
 * An amount that mixes measured months with unknown ones is never shown as a
 * single confident number (IA §1.2): "₪1,240 ועוד לא ידוע".
 */
export function partialTotal(formatted: string): string {
  return `${formatted} ועוד לא ידוע`;
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
