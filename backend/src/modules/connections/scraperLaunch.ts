// Loaded inside the sync worker: no imports from src/config or Prisma (see scraperWorker.ts).
import type { WorkerLaunchOptions } from "../../types/connections.types";

/** What officialLogin throws, and the errorType the parent turns it into, when she closes the bank window. */
export const BROWSER_CLOSED = "BROWSER_CLOSED";
/** The library's own tab closed while the window stayed open; the library then closes the window itself. */
export const BROWSER_TAB_CLOSED = "BROWSER_TAB_CLOSED";
/** Progress the worker sends once Chrome is really up — the only proof a failure was not ours. */
export const BROWSER_STARTED = "BROWSER_STARTED";
/** The errorType when Chrome never started: nothing reached the bank. */
export const BROWSER_LAUNCH = "BROWSER_LAUNCH";

/**
 * Exactly what the worker hands createScraper. No `args` beyond the profile — never
 * --no-sandbox — and no storeFailureScreenShotPath: a failure screenshot can hold
 * account numbers, balances or a live QR.
 */
export function libraryOptions(options: WorkerLaunchOptions) {
  return {
    companyId: options.companyId,
    startDate: new Date(options.startDate),
    defaultTimeout: options.defaultTimeout,
    showBrowser: options.showBrowser,
    loginWaitMs: options.loginWaitMs,
    urlProbe: options.urlProbe ?? false,
    args: [`--user-data-dir=${options.profileDir}`],
    combineInstallments: false,
    verbose: false,
  };
}
