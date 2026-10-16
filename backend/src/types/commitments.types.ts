export interface StatementDebit {
  date: Date;
  description: string;
  amount: number;
  lineKind: string;
  loanRef: string | null;
}

export interface DetectedCommitment {
  /** Stable across overlapping statements, so a re-upload never adds a twin. */
  key: string;
  kind: "loan" | "recurring";
  name: string;
  /** The latest month's amount — what the household pays now. */
  amount: number;
  dayOfMonth: number;
  months: number;
  lastDate: string;
  nextDate: string;
  loanNumber: string | null;
}
