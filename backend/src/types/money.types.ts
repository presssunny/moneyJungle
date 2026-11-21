/** A sum where an unknown amount is counted, not added as 0: the known part is a lower bound. */
export interface KnownSum {
  knownTotal: number;
  unknownCount: number;
}

/**
 * Where an amount comes from: a bank schedule row, a figure she stated, the last debit
 * a statement showed (the next may differ), or a reminder's estimate.
 */
export type AmountBasis = "schedule" | "stated" | "last_debit" | "estimate";

/**
 * How much of a calendar month the bank statements cover (banker 2026-10-27). A month no
 * statement reaches is "unknown" — not partial; the current month is never "complete".
 */
export type MonthCoverage =
  | { state: "unknown" }
  | { state: "complete" | "to_date"; from: string; to: string }
  | { state: "partial"; from: string | null; to: string | null };
