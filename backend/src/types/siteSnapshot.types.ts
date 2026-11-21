import type { ScrapedLoan, ScrapedStandingOrder } from "./connections.types";

/** What the bank's own pages showed after her sign-in (CLAUDE.md §7 A2): reviewed on the import screen, never a stored fact by itself. */
export type SiteSnapshotKind = "loan_details" | "standing_orders";

/** A loan track from the bank's loans page — no schedule rows; those come only from her own file. */
export type SnapshotLoan = Omit<ScrapedLoan, "schedule">;

/** The Loan fields a snapshot may fill in; monthlyPayment, startDate and the original amount are never among them. */
export type SnapshotLoanField = "currentBalance" | "annualInterestRate" | "endDate" | "totalPayments" | "paymentsMade" | "trackNumber" | "isIndexLinked";
export type SnapshotLoanValue = number | string | boolean;

export type LoanMatchReason = "matched" | "no_loan" | "ambiguous";

export interface LoanDetailsPreviewItem {
  key: string;
  loanNumberLast4: string;
  trackNumber: string | null;
  name: string | null;
  principalBalance: number | null;
  annualInterestRate: number | null;
  nextPaymentAmount: number | null;
  nextPaymentDate: string | null;
  paymentsMade: number | null;
  paymentsTotal: number | null;
  endDate: string | null;
  interestType: ScrapedLoan["interestType"];
  indexLinked: boolean | null;
  indexedBalance: number | null;
  /** The bank's day for these figures, else the sync day. */
  asOf: string;
  /** Fields the page did not show — "לא הופיע בדף", never 0. */
  missing: string[];
  match: { loanId: number | null; loanName: string | null; checkingLines: number; reason: LoanMatchReason };
  /** What approving would write into the matched loan. */
  fills: Array<{ field: SnapshotLoanField; value: SnapshotLoanValue }>;
  /** Shown, never written: a figure that differs from hers or from her bank file. */
  notes: string[];
}

export interface LoanDetailsPreview { kind: "loan_details"; loans: LoanDetailsPreviewItem[]; }

export type StandingOrderMatchReason = "matched" | "no_checking_debit" | "ambiguous";

export interface StandingOrderPreviewItem {
  key: string;
  payee: string;
  amount: number | null;
  dayOfMonth: number | null;
  kind: ScrapedStandingOrder["kind"];
  status: ScrapedStandingOrder["status"];
  match: {
    detectedKey: string | null;
    name: string | null;
    lastDebitDate: string | null;
    reason: StandingOrderMatchReason;
    /** Already a recurring payment: approving labels it "אומת באתר הבנק". */
    recurringPaymentId: number | null;
    /** Not saved yet: she may tick it, and it is added from the checking debit. */
    canAdd: boolean;
  };
}

export interface StandingOrdersPreview { kind: "standing_orders"; orders: StandingOrderPreviewItem[]; }

export type SiteSnapshotPreview = LoanDetailsPreview | StandingOrdersPreview;

/** What one approved loan_details session wrote per loan — the record of which fields a snapshot owns. */
export interface LoanSnapshotRecord { loanId: number; asOf: string; fields: Partial<Record<SnapshotLoanField, SnapshotLoanValue>>; }
