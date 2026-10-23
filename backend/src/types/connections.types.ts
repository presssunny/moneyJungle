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

export interface ScrapeResult {
  success: boolean;
  accounts?: ScrapedAccount[];
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
}

export interface WorkerLaunchOptions {
  companyId: ConnectionProvider;
  startDate: string;
  defaultTimeout: number;
  showBrowser: boolean;
  /** How long an official-window login may wait for her; ignored by the library itself. */
  loginWaitMs: number;
  /** Per-run Chrome profile, deleted with the run directory — never a persistent profile. */
  profileDir: string;
  /** Diagnostics for a supervised real test: log the host and path of each page the window visits. */
  urlProbe?: boolean;
}

/** Parent → sync worker. Credentials travel only inside `scrape`, never in argv or env. */
export type WorkerCommand =
  | { type: "start"; library: string; options: WorkerLaunchOptions }
  | { type: "scrape"; credentials: Record<string, string> };

/** Sync worker → parent. Untrusted: the parent validates every message before use. */
export type WorkerEvent =
  | { type: "ready" }
  | { type: "progress"; progress: string }
  | { type: "result"; result: unknown }
  | { type: "error"; code: "MISSING_LIBRARY" | "UNSUPPORTED" | "CRASH"; message: string };
