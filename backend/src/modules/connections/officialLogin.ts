// Loaded inside the sync worker in place of the library's createScraper, for an official_window
// login. No imports from src/config or Prisma (see scraperWorker.ts).
import BeinleumiScraper from "israeli-bank-scrapers/lib/scrapers/beinleumi";
import { getPossibleLoginResults } from "israeli-bank-scrapers/lib/scrapers/base-beinleumi-group";
import { LoginResults, type LoginOptions } from "israeli-bank-scrapers/lib/scrapers/base-scraper-with-browser";
import { TimeoutError } from "israeli-bank-scrapers/lib/helpers/waiting";
import type { Browser, Page } from "puppeteer";
import { PROVIDERS } from "./providers";
import { BROWSER_CLOSED } from "./scraperLaunch";

/**
 * The bank's public site. She opens its login and picks the method there (password, app, QR):
 * this code fills no field and clicks nothing on the bank's page (CLAUDE.md §7).
 */
export const OFFICIAL_LOGIN_URL = PROVIDERS.beinleumi.officialLoginUrl!;
const POLL_MS = 1_000;

const signedIn = (url: string) => (getPossibleLoginResults()[LoginResults.Success] ?? []).some((pattern) => pattern instanceof RegExp && pattern.test(url));

/**
 * Waits until any tab of the window reaches the bank's logged-in area — the library's own
 * success URLs. If she signed in on another tab, the library's page follows it there: tabs share
 * cookies, and the library judges the login by its own page's URL.
 */
export async function waitForSignIn(page: Page, waitMs: number): Promise<void> {
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    if (page.isClosed() || !page.browser().connected) throw new Error(BROWSER_CLOSED);
    const pages = await page.browser().pages().catch(() => [page]);
    const tab = pages.find((candidate) => signedIn(candidate.url()));
    if (tab && tab !== page) await page.goto(tab.url());
    if (tab) return;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  throw new TimeoutError("official login not completed in time");
}

interface OfficialOptions {
  loginWaitMs: number;
  [option: string]: unknown;
}

export function createScraper(options: OfficialOptions) {
  // The library closes the browser itself when it terminates; only an earlier close is hers.
  let terminating = false;
  const scraper = new BeinleumiScraper({
    ...options,
    companyId: "beinleumi",
    prepareBrowser: async (browser: Browser) => {
      browser.on("disconnected", () => {
        if (!terminating) (scraper as unknown as { emitProgress(type: string): void }).emitProgress(BROWSER_CLOSED);
      });
    },
  } as unknown as ConstructorParameters<typeof BeinleumiScraper>[0]);
  scraper.onProgress((_company, payload) => {
    if (payload.type === "TERMINATING") terminating = true;
  });
  const page = () => (scraper as unknown as { page: Page }).page;
  const loginOptions = (): LoginOptions => ({
    loginUrl: OFFICIAL_LOGIN_URL,
    fields: [],
    checkReadiness: async () => {},
    submitButtonSelector: async () => {},
    postAction: () => waitForSignIn(page(), options.loginWaitMs),
    possibleResults: getPossibleLoginResults(),
  });
  return Object.assign(scraper, { getLoginOptions: loginOptions });
}
