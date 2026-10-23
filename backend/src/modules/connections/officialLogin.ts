// Loaded inside the sync worker in place of the library's createScraper, for an official_window
// login. No imports from src/config or Prisma (see scraperWorker.ts).
import BeinleumiScraper from "israeli-bank-scrapers/lib/scrapers/beinleumi";
import { getPossibleLoginResults, waitForPostLogin } from "israeli-bank-scrapers/lib/scrapers/base-beinleumi-group";
import { LoginResults, type LoginOptions } from "israeli-bank-scrapers/lib/scrapers/base-scraper-with-browser";
import { sleep, TimeoutError } from "israeli-bank-scrapers/lib/helpers/waiting";
import type { Browser, Frame, Page } from "puppeteer";
import { PROVIDERS } from "./providers";
import { BROWSER_CLOSED } from "./scraperLaunch";

/**
 * The bank's public site. She opens its login and picks the method there (password, app, QR):
 * this code fills no field and clicks nothing on the bank's page (CLAUDE.md §7).
 */
export const OFFICIAL_LOGIN_URL = PROVIDERS.beinleumi.officialLoginUrl!;
const POLL_MS = 1_000;
// After a success URL: its own budget, so a sign-in in her last second is not lost to it.
const SETTLE_MS = 20_000;
// The portal hops /FibiMenu/Online → /PortalNG/shell about a second after sign-in; both match.
const QUIET_MS = 3_000;
const CHECK_MS = 500;
const CONTEXT_DESTROYED = "Execution context was destroyed";
// timeOrigin is fixed per loaded document, so the portal's own in-page routing (pushState) leaves it alone.
const DOCUMENT = "[location.href, performance.timeOrigin]";

function ensureOpen(page: Page) {
  if (page.isClosed() || !page.browser().connected) throw new Error(BROWSER_CLOSED);
}

const signedIn = (url: string) => (getPossibleLoginResults()[LoginResults.Success] ?? []).some((pattern) => pattern instanceof RegExp && pattern.test(url));

/** Null while a new document is replacing the old one. */
async function currentDocument(page: Page): Promise<{ href: string; origin: number } | null> {
  try {
    const value: unknown = await page.evaluate(DOCUMENT);
    return Array.isArray(value) && typeof value[0] === "string" && typeof value[1] === "number" ? { href: value[0], origin: value[1] } : null;
  } catch (error) {
    ensureOpen(page);
    if (error instanceof Error && error.message.startsWith(CONTEXT_DESTROYED)) return null;
    throw error;
  }
}

/**
 * The library reads location.href right after our postAction. Returning on the first success URL
 * raced the portal's own redirect, the read died, and the library closed her window (sync 1675).
 * Settled = the library's post-login marker or a quiet spell, with no new document loaded across it.
 */
async function settle(page: Page): Promise<void> {
  const deadline = Date.now() + SETTLE_MS;
  const marker = waitForPostLogin(page).then(() => true, () => false);
  while (Date.now() < deadline) {
    ensureOpen(page);
    const before = await currentDocument(page);
    await Promise.race([marker, sleep(QUIET_MS)]);
    await sleep(CHECK_MS);
    const after = await currentDocument(page);
    if (before && after && before.origin === after.origin && signedIn(after.href)) return;
  }
  throw new TimeoutError("official login page did not settle");
}

/**
 * Waits until any tab of the window reaches the bank's logged-in area — the library's own
 * success URLs — and settles there. If she signed in on another tab, the library's page follows
 * it: tabs share cookies, and the library judges the login by its own page's URL.
 */
export async function waitForSignIn(page: Page, waitMs: number): Promise<void> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    ensureOpen(page);
    const pages = await page.browser().pages().catch(() => [page]);
    const tab = pages.find((candidate) => signedIn(candidate.url()));
    if (tab === page) return settle(page);
    // Another tab of hers closing is not a failure: keep waiting on what is left.
    const settledTab = tab && (await settle(tab).then(() => true, (error: unknown) => { if (tab.isClosed()) return false; throw error; }));
    if (tab && settledTab) {
      await page.goto(tab.url());
      return settle(page);
    }
    // Checked after the last sleep too, so a sign-in in her final second still counts.
    if (Date.now() >= deadline) throw new TimeoutError("official login not completed in time");
    await sleep(Math.min(POLL_MS, Math.max(0, deadline - Date.now())));
  }
}

/**
 * Host and path only: no query or fragment (tokens), nothing after WebSphere's "!" (encoded portal
 * state), and no long opaque segment. Null for anything that is not a web page.
 */
export function probePath(raw: string): string | null {
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const path = url.pathname.split("!")[0].split("/").map((segment) => (segment.length > 40 ? "…" : segment)).join("/");
  return `${url.hostname}${path}`;
}

// Off unless the server sets CONNECTION_URL_PROBE for a supervised test. To stderr only, which the
// parent redacts and logs: never a progress event, the DB or the UI. Reads URLs; touches no page.
function probeUrls(browser: Browser) {
  const started = Date.now();
  const seen = new Set<string>();
  const tabs = new Map<Page, number>();
  const write = (line: string) => process.stderr.write(`[probe +${Math.round((Date.now() - started) / 1000)}s] ${line}\n`);
  const watch = (page: Page | null) => {
    if (!page || tabs.has(page)) return;
    tabs.set(page, tabs.size + 1);
    page.on("framenavigated", (frame: Frame) => {
      const line = probePath(frame.url());
      const main = frame === page.mainFrame();
      if (!line || (!main && !line.split("/")[0].endsWith("fibi.co.il"))) return;
      const key = `tab ${tabs.get(page)} ${main ? "page" : "frame"} ${line}`;
      if (seen.has(key)) return;
      seen.add(key);
      write(key);
    });
  };
  void browser.pages().then((pages) => pages.forEach(watch)).catch(() => {});
  browser.on("targetcreated", (target) => { void target.page().then(watch).catch(() => {}); });
}

interface OfficialOptions {
  loginWaitMs: number;
  urlProbe?: boolean;
  prepareBrowser?: (browser: Browser) => Promise<unknown>;
  [option: string]: unknown;
}

export function createScraper(options: OfficialOptions) {
  // The library closes the browser itself when it terminates; only an earlier close is hers.
  let terminating = false;
  const scraper = new BeinleumiScraper({
    ...options,
    companyId: "beinleumi",
    prepareBrowser: async (browser: Browser) => {
      await options.prepareBrowser?.(browser);
      if (options.urlProbe) probeUrls(browser);
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
