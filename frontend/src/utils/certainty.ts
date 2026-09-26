export type Certainty = "measured" | "scenario" | "unknown";

/** The em dash shown instead of a number that we do not actually know. */
export const UNKNOWN_PLACEHOLDER = "—";

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
