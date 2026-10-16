export type ConnectionKind = "bank" | "card";
export type ConnectionProvider = "beinleumi" | "visaCal" | "max" | "isracard";
export type SyncStatus = "running" | "awaiting_approval" | "succeeded" | "failed";

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

/** One import session a sync produced — approved on the regular import screen. */
export interface SyncOutcomeItem {
  importSessionId: string | null;
  target: string;
  rows: number;
  skippedPending: number;
  skippedForeign: number;
  note?: string;
}
