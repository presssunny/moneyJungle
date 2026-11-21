import type { ConnectionProvider, LoanFollowUpDecision, LoginMethod, ScrapeResult } from "../../types/connections.types";

export interface ScraperOptions {
  companyId: ConnectionProvider;
  startDate: Date;
  /** Page-wait ceiling; the only lever that lets a login sit while the user approves on her phone. */
  defaultTimeout: number;
  loginMethod: LoginMethod;
  /** official_window only: how long the bank's page may wait for her to sign in. */
  loginWaitMs: number;
  /** Called at most once, after the checking fetch, while her session is still open. Must resolve fast. */
  decideFollowUp?: (checking: ScrapeResult) => Promise<LoanFollowUpDecision>;
}

export interface ScraperRun {
  onProgress(listener: (type: string) => void): void;
  scrape(credentials: Record<string, string>): Promise<ScrapeResult>;
  /** Stops the login or fetch now; scrape() then resolves with errorType CANCELLED. */
  cancel(): void;
}

export type ScraperFactory = (options: ScraperOptions) => Promise<ScraperRun>;
