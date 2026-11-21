import type { DepartmentStop, ReadableDepartment } from "../modules/connections/siteDepartments"; // type-only, as probeLog does

export type ConnectionKind = "bank" | "card";
export type ConnectionProvider = "beinleumi" | "visaCal" | "max" | "isracard";
export type SyncStatus = "running" | "succeeded" | "failed" | "cancelled";
/** Where a running sync is, set only from real worker/library events. */
export type SyncPhase = "queued" | "launching" | "awaiting_user" | "awaiting_bank" | "fetching" | "building_import";
/**
 * password — sealed credentials, headless login.
 * official_window — a visible Chrome window on the bank's own site; she picks the method and signs in there.
 */
export type LoginMethod = "password" | "official_window";

/** The subset of israeli-bank-scrapers' Transaction this app reads. */
export interface ScrapedTransaction {
  type: "normal" | "installments";
  date: string;
  processedDate: string;
  originalAmount: number;
  originalCurrency: string;
  chargedAmount: number;
  chargedCurrency?: string;
  description: string;
  memo?: string;
  status: "completed" | "pending";
  installments?: { number: number; total: number };
}

export interface ScrapedAccount {
  accountNumber: string;
  balance?: number;
  txns: ScrapedTransaction[];
}

/** One payment of a loan track's schedule as the bank printed it. A part it did not print is null, never 0. */
export interface ScrapedLoanPayment {
  paymentNumber: number;
  date: string;
  principal: number | null;
  interest: number | null;
  /** CPI linkage differences: a financing cost like interest, never principal (CLAUDE.md §5). */
  linkage: number | null;
  total: number | null;
  balanceAfter: number | null;
}

/**
 * A loan track read after her sign-in: evidence for her to review through the import, never a stored fact.
 * Amounts are positive shekels, rates are percents (6.5, not 0.065); a schedule's `total` is a payment, not an expense.
 */
export interface ScrapedLoan {
  loanNumber: string;
  trackNumber: string | null;
  name: string | null;
  /** The day the bank states these figures for. */
  asOf: string | null;
  originalAmount: number | null;
  /** Nominal: Σ schedule principal is checked against it. Never added to indexedBalance. */
  principalBalance: number | null;
  /** A CPI-linked balance as the bank revalued it; we never revalue it ourselves. */
  indexedBalance: number | null;
  interestType: "fixed" | "prime" | "variable" | null;
  annualInterestRate: number | null;
  primeMargin: number | null;
  indexLinked: boolean | null;
  baseIndex: number | null;
  /** YYYY-MM of the base index. */
  baseIndexMonth: string | null;
  /** The schedule does not mark paid rows, so these come from the bank's own count. */
  paymentsMade: number | null;
  paymentsTotal: number | null;
  startDate: string | null;
  endDate: string | null;
  nextPaymentAmount: number | null;
  nextPaymentDate: string | null;
  /** Empty when the bank gave no rows: then it is a snapshot, not a schedule. */
  schedule: ScrapedLoanPayment[];
}

export type LoanDepartmentResult = "landed" | DepartmentStop | "NO_DECISION" | "NOT_NEEDED";
export type LoanDetailsResult = "NOT_APPROVED" | "READ" | "UNAVAILABLE" | "FAILED" | "NOT_RUN";
export interface DepartmentFollowUp {
  department: LoanDepartmentResult;
  details: LoanDetailsResult;
  /** With READ: table rows the worker could not place (a count, never their content). */
  rejected?: number;
}
/** What the worker's follow-up did. Counts and codes only, never a value read from the page. */
export interface LoanFollowUpReport extends DepartmentFollowUp { standingOrders?: DepartmentFollowUp; }

/** One row of the bank's standing-orders page (CLAUDE.md §7 A2); references cut to their last 4 digits. */
export interface ScrapedStandingOrder {
  payee: string;
  amount: number | null;
  dayOfMonth: number | null;
  kind: "standing_order" | "direct_debit" | null;
  status: "active" | "inactive" | null;
  reference: string | null;
  /** YYYY-MM-DD */
  lastChargeDate: string | null;
}

export type ExtrasError = "EXTRAS_INVALID";

/** Read after the checking account's fetch, and never part of its success or failure. */
export interface ScrapeExtras {
  loans?: ScrapedLoan[];
  standingOrders?: ScrapedStandingOrder[];
  followUp?: LoanFollowUpReport;
  errors: ExtrasError[];
}

export interface LoanFollowUpDecision { loans: boolean; standingOrders: boolean; }

export interface ScrapeResult {
  success: boolean;
  accounts?: ScrapedAccount[];
  extras?: ScrapeExtras;
  errorType?: string;
  errorMessage?: string;
}

export interface PendingRef {
  date: string;
  description: string;
  amount: number;
}

/** A row charged in another currency: kept out of the import, listed so she can add it from the card's file. */
export interface ForeignRef {
  date: string;
  description: string;
  originalAmount: number;
  originalCurrency: string;
  chargedAmount: number | null;
  chargedCurrency: string | null;
}

/** The site's balance at sync time against ours as of the last day the sync covered. */
export interface BalanceCheck {
  status: "match" | "gap" | "unknown" | "circular";
  ourBalance: number | null;
  /** ours − site; null unless compared. */
  gap: number | null;
  asOf: string;
}

/** One import session a sync produced — approved on the regular import screen. */
export interface SyncOutcomeItem {
  /** bank:<accountId> | card:<cardId> | card-digits:<last four> — matches carried pending rows to their target. */
  key: string;
  importSessionId: string | null;
  target: string;
  rows: number;
  skippedPending: number;
  skippedForeign: number;
  skippedZero: number;
  /** Rows after this day were new; null when nothing was stored yet (then 90 days back). */
  storedThrough: string | null;
  pending: PendingRef[];
  /** At most FOREIGN_LIST_CAP rows; skippedForeign holds the full count. */
  foreign: ForeignRef[];
  /** The bank site's own balance at sync time — shown as the site's figure, never stored as ours. */
  siteBalance?: number | null;
  note?: string;
  /** Absent = an account item (rows already stored keep working). */
  kind?: "account" | "loan_schedule" | "loan_details" | "standing_orders";
  /** Only on a bank sync's account item: the sync-wide stage list. */
  stages?: SyncStage[];
}

export type SyncStageName = "checking" | "loan_detection" | "loans_department" | "loan_details" | "loan_schedule_import"
  | "standing_orders_detection" | "standing_orders_verification" | "bank_documents";
/** done=complete · partial=some · skipped=by design/nothing to do · blocked=policy · failed=tried and failed. */
export type SyncStageState = "done" | "partial" | "skipped" | "blocked" | "failed";
export interface SyncStage {
  stage: SyncStageName;
  state: SyncStageState;
  /** Machine code: a DepartmentStop, NOT_APPROVED, DISABLED, NO_LOAN_LINES, SCHEDULE_INCOMPLETE, INDEX_LINKED, IDENTIFIER_UNREADABLE, AMBIGUOUS, ROWS_UNRECOGNIZED, EXTRAS_INVALID, INFERRED, NO_RECURRING, WINDOW_TOO_SHORT… */
  code: string | null;
  /** Counts only (no amount, rate or loan number). */
  count?: number;
  /** With ROWS_UNRECOGNIZED: rows of the bank's table the worker could not place (a count only). */
  rejected?: number;
}
/** Her view of a stage; never stored — the API computes it (syncStageStatus.ts), so old syncs get it too. */
export type SyncStageStatus = "done" | "not_needed" | "failed" | "unavailable" | "blocked" | "awaiting_approval";
export interface PresentedSyncStage extends SyncStage { status: SyncStageStatus; }

export interface WorkerLaunchOptions {
  companyId: ConnectionProvider;
  startDate: string;
  defaultTimeout: number;
  showBrowser: boolean;
  /** How long an official-window login may wait for her; ignored by the library itself. */
  loginWaitMs: number;
  /** Per-run Chrome profile, deleted with the run directory — never a persistent profile. */
  profileDir: string;
  /** A supervised probe run: the window's URL templates go to the parent, and no account is read. */
  urlProbe?: boolean;
  /** With urlProbe: after her sign-in the bank's app visits its own department pages (CLAUDE.md §7 clause A). */
  siteDiscovery?: boolean;
  /** official_window, not a probe: after the checking fetch, ask the parent and maybe move to the loans department (§7 clause A). */
  loansDepartment?: boolean;
  /** With loansDepartment: the departments whose tables may be read once landed (CONNECTION_DEPARTMENT_READ, §7 A2). */
  departmentRead?: ReadableDepartment[];
}

/** Parent → sync worker. Credentials travel only inside `scrape`, never in argv or env. */
export type WorkerCommand =
  | { type: "start"; library: string; options: WorkerLaunchOptions }
  | { type: "scrape"; credentials: Record<string, string> }
  | { type: "followUp"; decision: LoanFollowUpDecision };

/** Sync worker → parent. Untrusted: the parent validates every message before use. */
export type WorkerEvent =
  | { type: "ready" }
  | { type: "progress"; progress: string }
  | { type: "result"; result: unknown }
  | { type: "probe"; line: string }
  | { type: "error"; code: "MISSING_LIBRARY" | "UNSUPPORTED" | "CRASH"; message: string }
  | { type: "checking"; result: unknown }; // sent at most once, only when loansDepartment
