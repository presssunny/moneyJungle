import type { AmountBasis } from "./money.types";

export interface Commitment {
  key: string;
  date: string;
  name: string;
  amount: number | null;
  kind: string;
  fingerprint: string;
  decision: string | null;
  note: string | null;
  to: string;
  /** Where a projected amount comes from; absent on card bills (summed from the card file). */
  basis?: AmountBasis;
}

export interface ReviewItem {
  topic?: string;
  key: string;
  title: string;
  to: string;
  blocking: boolean;
  fingerprint: string;
}
