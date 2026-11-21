// Loaded inside the sync worker in place of the library's createScraper, for an official_window
// login. No imports from src/config or Prisma (see scraperWorker.ts).
import BeinleumiScraper from "israeli-bank-scrapers/lib/scrapers/beinleumi";
import { getPossibleLoginResults, waitForPostLogin } from "israeli-bank-scrapers/lib/scrapers/base-beinleumi-group";
import { LoginResults, type LoginOptions } from "israeli-bank-scrapers/lib/scrapers/base-scraper-with-browser";
import { sleep, TimeoutError } from "israeli-bank-scrapers/lib/helpers/waiting";
import type { Browser, Frame, HTTPRequest, Page, Target } from "puppeteer";
import { PROVIDERS } from "./providers";
import { BROWSER_CLOSED, BROWSER_TAB_CLOSED, LOAN_FOLLOW_UP_MS, PROBE_DONE, PROBE_SIGNED_IN } from "./scraperLaunch";
import { NOT_APPROVED_DETAILS, TABLE_LOAN_DETAILS, TABLE_STANDING_ORDER_DETAILS, type LoanDetailsSource, type StandingOrderDetailsSource } from "./departmentRead";
import { isReadableDepartment, type DepartmentStop, type ReadableDepartment, type SiteDepartment } from "./siteDepartments";
import { discoverDepartments, stillLanded } from "./siteDiscovery";

export type { LoanDetailsSource, StandingOrderDetailsSource } from "./departmentRead";

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
  if (!page.browser().connected) throw new Error(BROWSER_CLOSED);
  if (page.isClosed()) throw new Error(BROWSER_TAB_CLOSED);
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

const WORD = /^[A-Za-z][A-Za-z_.-]{0,30}$/;
const HOST_LABEL = /^[a-z][a-z-]{0,30}$/;
const BANK_HOST = "fibi.co.il";
const PROBE_TYPES = new Set(["document", "xhr", "fetch"]);
/** After her sign-in in a probe run: her own clicks through the site. With a 5-minute sign-in and settling, still inside the worker's 15-minute hard limit. */
export const PROBE_BROWSE_MS = 6 * 60_000;
/** A discovery run's pass over the departments, inside the same budget. */
export const DISCOVERY_MS = 3 * 60_000;

/**
 * A template of host and path: a segment survives only as a plain ASCII word, anything else
 * (digits, ids, tokens, encoded text) is ":id". Cut at "!" and ";" (portal state, jsessionid);
 * no query or fragment. Null for anything that is not a web page.
 */
export function probePath(raw: string): string | null {
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.split(".").map((label) => (HOST_LABEL.test(label) ? label : ":id")).join(".");
  const path = url.pathname.split(/!|%21/i)[0].split("/").map((segment) => {
    const head = segment.split(";")[0];
    return head === "" || WORD.test(head) ? head : ":id";
  }).join("/");
  return `${host}${path}`;
}

const bankHost = (template: string) => {
  const host = template.split("/")[0];
  return host === BANK_HOST || host.endsWith(`.${BANK_HOST}`);
};

/**
 * Only with a sink, which the worker passes for a supervised probe run. Reads the URL, method and
 * type of what her window loads — never a body, header or response — and touches no page.
 */
export function probeUrls(browser: Browser, write: (line: string) => void) {
  const seen = new Set<string>();
  const tabs = new Map<Page, number>();
  // While discovery has moved the app to a department, what loads is credited to it.
  let department: SiteDepartment | null = null;
  const once = (raw: string) => {
    const line = department ? `dept ${department} ${raw}` : raw;
    if (seen.has(line)) return;
    seen.add(line);
    write(line);
  };
  const watch = (page: Page | null) => {
    if (!page || tabs.has(page)) return;
    const tab = tabs.size + 1;
    tabs.set(page, tab);
    page.on("framenavigated", (frame: Frame) => {
      const template = probePath(frame.url());
      const main = frame === page.mainFrame();
      if (template && (main || bankHost(template))) once(`tab ${tab} ${main ? "page" : "frame"} ${template}`);
    });
    // Another site's requests (analytics, fonts) by host alone: their paths teach nothing about the bank.
    page.on("request", (request: HTTPRequest) => {
      const type = request.resourceType();
      const template = PROBE_TYPES.has(type) ? probePath(request.url()) : null;
      if (template) once(`tab ${tab} ${request.method()} ${type} ${bankHost(template) ? template : template.split("/")[0]}`);
    });
    page.on("close", () => write(`tab ${tab} closed`));
  };
  void browser.pages().then((pages) => pages.forEach(watch)).catch(() => {});
  // The target's own URL at once: a new tab's first document can load before its page object resolves.
  browser.on("targetcreated", (target: Target) => {
    const template = probePath(target.url());
    if (template) once(`new ${template}`);
    void target.page().then(watch).catch(() => {});
  });
  return { attribute: (next: SiteDepartment | null) => { department = next; } };
}

/** Her window stays hers until she closes it or the browse time runs out; nothing here reads it. */
function untilClosed(browser: Browser, waitMs: number): Promise<void> {
  if (!browser.connected) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, waitMs);
    browser.once("disconnected", () => { clearTimeout(timer); resolve(); });
  });
}

/** A department outside CONNECTION_DEPARTMENT_READ: kept under its old name for the tests and the stub. */
export const NOT_APPROVED_LOAN_DETAILS: LoanDetailsSource = NOT_APPROVED_DETAILS;

const TIMED_OUT = Symbol("timed out");
function within<T>(work: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => { timer = setTimeout(() => resolve(TIMED_OUT), Math.max(0, ms)); });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

type FollowUpDecide = (checking: unknown) => Promise<{ loans: boolean; standingOrders?: boolean; timedOut?: boolean }>;
type Report = { department: string; details: string; rejected?: number };
// Only a stop that cannot involve her session or the bank's protection lets the next department go ahead.
const LOCAL_STOPS: readonly string[] = ["NOT_IN_MENU", "ERROR", "EXCLUDED"] satisfies DepartmentStop[];
type ItemsKey = "loans" | "standingOrders";
type DetailsSource<K extends ItemsKey> = { read(page: Page, deadline: number): Promise<{ status: string; rejected?: number } & { [key in K]?: unknown[] }> };

interface FollowUpOptions {
  decide: FollowUpDecide; signedIn: (url: string) => boolean; loanDetails: LoanDetailsSource; standingOrderDetails?: StandingOrderDetailsSource; budgetMs: number;
}
export interface FollowUpExtras { loans?: unknown[]; standingOrders?: unknown[]; followUp: Report & { standingOrders: Report } }

/**
 * After the checking fetch, with her session still open: ask the parent, then at most one move to each
 * department it wants, loans first (§7 clause A, discovery's own stop rules, no retry). A table read runs
 * only on a page landed on in this pass and re-checked just before it (§7 A2). Never throws; every step is
 * cut at the budget, so the checking import is never held past it.
 */
export async function departmentFollowUp(page: Page, checking: unknown, o: FollowUpOptions): Promise<FollowUpExtras> {
  const deadline = Date.now() + o.budgetMs;
  const left = () => deadline - Date.now();
  const report = (loans: Report, standingOrders: Report, read: { loans?: unknown[]; standingOrders?: unknown[] } = {}): FollowUpExtras => ({ ...read, followUp: { ...loans, standingOrders } });
  let decision: Awaited<ReturnType<FollowUpDecide>> | typeof TIMED_OUT;
  try {
    decision = await within(o.decide(checking), left());
  } catch {
    return report({ department: "ERROR", details: "FAILED" }, { department: "ERROR", details: "NOT_RUN" });
  }
  if (decision === TIMED_OUT || decision.timedOut) return report({ department: "NO_DECISION", details: "NOT_RUN" }, { department: "NO_DECISION", details: "NOT_RUN" });
  let stopAll: string | null = null;
  const visit = async <K extends ItemsKey>(wanted: boolean, department: ReadableDepartment, source: DetailsSource<K>, key: K): Promise<{ report: Report; items?: unknown[] }> => {
    if (!wanted) return { report: { department: "NOT_NEEDED", details: "NOT_RUN" } };
    if (stopAll) return { report: { department: stopAll, details: "NOT_RUN" } };
    let reached = "ERROR";
    try {
      const tabs = (await page.browser().pages()).length;
      let landedUrl: string | null = null;
      const visits = await within(discoverDepartments(page, {
        only: [department], write: () => {}, attribute: () => {}, signedIn: o.signedIn, deadline, gapMs: 0, landed: (_department, url) => { landedUrl = url; },
      }), left());
      reached = visits === TIMED_OUT ? "BUDGET" : visits.get(department) ?? "ERROR";
      if (reached === "landed") reached = landedUrl === null ? "ERROR" : (await stillLanded(page, landedUrl, tabs, o.signedIn)) ?? "landed";
      if (reached !== "landed") {
        if (!LOCAL_STOPS.includes(reached)) stopAll = reached;
        return { report: { department: reached, details: "NOT_RUN" } };
      }
      const read = await within(source.read(page, deadline), left());
      if (read === TIMED_OUT) return { report: { department: reached, details: "FAILED" } };
      if (read.status !== "READ") return { report: { department: reached, details: read.status } };
      const items = read[key];
      const rejected = typeof read.rejected === "number" ? { rejected: read.rejected } : {};
      return Array.isArray(items) ? { report: { department: reached, details: "READ", ...rejected }, items } : { report: { department: reached, details: "FAILED" } };
    } catch {
      return { report: { department: reached, details: "FAILED" } };
    }
  };
  const loans = await visit(decision.loans === true, "loans", o.loanDetails, "loans");
  const orders = await visit(decision.standingOrders === true, "standing_orders", o.standingOrderDetails ?? NOT_APPROVED_DETAILS, "standingOrders");
  return report(loans.report, orders.report, { ...(loans.items && { loans: loans.items }), ...(orders.items && { standingOrders: orders.items }) });
}

interface OfficialOptions {
  loginWaitMs: number;
  /** A probe run: lines go here, and after her sign-in the library's fetch never runs. */
  probe?: (line: string) => void;
  probeBrowseMs?: number;
  /** A discovery run (§7 clause A): after her sign-in, the bank's app visits its own department pages. Probe runs only. */
  siteDiscovery?: boolean;
  discoveryMs?: number;
  prepareBrowser?: (browser: Browser) => Promise<unknown>;
  /** A sync with the loans flag, never a probe: asked once after the checking fetch, while her session is open. */
  decideFollowUp?: FollowUpDecide;
  /** CONNECTION_DEPARTMENT_READ as the worker validated it: only these departments' tables are read (§7 A2). */
  departmentRead?: readonly unknown[];
  /** Tests only; the worker never passes one, so a real sync reads with the fixed table read or not at all. */
  loanDetails?: LoanDetailsSource;
  standingOrderDetails?: StandingOrderDetailsSource;
  loanFollowUpMs?: number;
  [option: string]: unknown;
}

/** The fixed table read only for a department in the read list; any other answers NOT_APPROVED untouched. */
export function detailsSources(options: Pick<OfficialOptions, "departmentRead" | "loanDetails" | "standingOrderDetails">) {
  const reads = new Set<ReadableDepartment>((options.departmentRead ?? []).filter(isReadableDepartment));
  return {
    loanDetails: options.loanDetails ?? (reads.has("loans") ? TABLE_LOAN_DETAILS : NOT_APPROVED_DETAILS),
    standingOrderDetails: options.standingOrderDetails ?? (reads.has("standing_orders") ? TABLE_STANDING_ORDER_DETAILS : NOT_APPROVED_DETAILS),
  };
}

export function createScraper(options: OfficialOptions) {
  // The library closes the browser itself when it terminates; only an earlier close is hers.
  let terminating = false;
  let attribute: (department: SiteDepartment | null) => void = () => {};
  const scraper = new BeinleumiScraper({
    ...options,
    companyId: "beinleumi",
    prepareBrowser: async (browser: Browser) => {
      await options.prepareBrowser?.(browser);
      if (options.probe) attribute = probeUrls(browser, options.probe).attribute;
      browser.on("disconnected", () => {
        if (!terminating) (scraper as unknown as { emitProgress(type: string): void }).emitProgress(BROWSER_CLOSED);
      });
    },
  } as unknown as ConstructorParameters<typeof BeinleumiScraper>[0]);
  scraper.onProgress((_company, payload) => {
    if (payload.type === "TERMINATING") terminating = true;
  });
  const page = () => (scraper as unknown as { page: Page }).page;
  const emit = (type: string) => (scraper as unknown as { emitProgress(type: string): void }).emitProgress(type);
  // Thrown, so the library's login fails and its fetch never starts: a probe run reads no account.
  const probeOnly = async () => {
    await waitForSignIn(page(), options.loginWaitMs);
    emit(PROBE_SIGNED_IN);
    if (options.siteDiscovery && options.probe) {
      await discoverDepartments(page(), { write: options.probe, attribute, signedIn, deadline: Date.now() + (options.discoveryMs ?? DISCOVERY_MS) });
    } else {
      await untilClosed(page().browser(), options.probeBrowseMs ?? PROBE_BROWSE_MS);
    }
    throw new Error(PROBE_DONE);
  };
  const loginOptions = (): LoginOptions => ({
    loginUrl: OFFICIAL_LOGIN_URL,
    fields: [],
    checkReadiness: async () => {},
    submitButtonSelector: async () => {},
    postAction: options.probe ? probeOnly : () => waitForSignIn(page(), options.loginWaitMs),
    possibleResults: getPossibleLoginResults(),
  });
  // Left untouched without the flag, so the checking result is exactly the library's. Inside fetchData, the
  // follow-up runs before the library's terminate() closes her window.
  const decide = options.decideFollowUp;
  if (decide && !options.probe) {
    const fetchChecking = scraper.fetchData.bind(scraper);
    scraper.fetchData = async () => {
      const checking = await fetchChecking();
      if (!checking.success) return checking;
      return { ...checking, extras: await departmentFollowUp(page(), checking, { decide, signedIn, ...detailsSources(options), budgetMs: options.loanFollowUpMs ?? LOAN_FOLLOW_UP_MS }) };
    };
  }
  return Object.assign(scraper, { getLoginOptions: loginOptions });
}
