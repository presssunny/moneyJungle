// Loaded inside the sync worker (see scraperWorker.ts): no src/config or Prisma.
// CLAUDE.md §7 clause A: after her sign-in, the bank's own app may be moved, in the same tab, to a
// verified department page — one its own menu shows her now, matching a department below, with
// word-only segments on the same origin. Nothing here clicks, fills, builds a request or reads a page.
import type { Browser, Page } from "puppeteer";
import { sleep } from "israeli-bank-scrapers/lib/helpers/waiting";
import { EXCLUDED_DEPARTMENTS, SITE_DEPARTMENTS, type DepartmentStop, type DepartmentVisit, type SiteDepartment } from "./siteDepartments";

// Substrings, not \b: JS word boundaries do not see Hebrew letters.
const LABELS: Record<SiteDepartment, readonly string[]> = {
  loans: ["הלוואות", "הלוואה", "משכנתא"],
  cards: ["כרטיסי אשראי", "כרטיס אשראי", "כרטיסי חיוב", "חיובי כרטיס", "חיובים בכרטיס", "עסקאות בכרטיס"],
  standing_orders: ["הוראות קבע", "הוראת קבע", "הרשאות לחיוב", "הרשאה לחיוב", "הרשאות חיוב"],
  cheques: ["שיק", "שקים", "צ'ק", "צ׳ק", "המחאות"],
  deposits: ["פיקדונות", "פקדונות", "פיקדון", "פקדון", "חסכונות", "חיסכון", "חסכון", 'פק"מ', "פק״מ", "פקמ"],
};
// The route must name the department too, so a label alone never sends the app elsewhere.
const ROUTE_NOUNS: Record<SiteDepartment, readonly string[]> = {
  loans: ["loans", "loan", "mortgage", "mortgages"],
  cards: ["credit", "creditcard", "creditcards", "cards", "card"],
  standing_orders: ["standing"],
  cheques: ["cheques", "checks"],
  deposits: ["deposits", "savings", "saving"],
};
// A link that does something rather than shows something, or offers something (banker 2026-11-07).
// Any repayment schedule too: her own schedule file is the source of truth for a loan's terms.
const ACTION_LABELS = ["הזמנ", "העבר", "ביטול", "בטל", "הצטרפ", "בקש", "הגש", "עדכ", "שינוי", "לתשלום", "ביצוע", "הפקד", "משיכ", "פתיחת",
  "יציאה", "התנתק", "הוספ", "הוסף", "חדש", "אישור", "הפסק", "הקפא", "קבל", "חתימ", "שליחת", "שלח", "פירעון", "פרעון", "סילוק", "החזר",
  "לקיחת", "מתן", "הצע", "בקליק", "מיידי", "אונליין", "בתנאים", "שביר", "מימוש", "פדיון", "השקע", "עמלות", "הקמ", "הגדל", "הלוואה חדשה",
  "חסימ", "הפעל", "סימולטור", "מחשבון"];
/**
 * Every camel-case word of a route must be a known view or department word: an unknown one
 * (EarlyRepayment, BreakDeposit, LOANREQ) marks the department missing instead of being visited.
 * "Deposit" and "Cheque" stay out in the singular, where they are verbs as often as nouns.
 */
const VIEW_ROUTE_WORDS = new Set(["online", "on", "onln", "auth", "menu", "private", "my", "main", "home", "account", "accounts", "current",
  "loans", "loan", "mortgage", "mortgages", "credit", "creditcard", "creditcards", "cards", "card", "standing", "orders", "cheques", "checks", "deposits", "savings", "saving",
  "details", "detail", "dets", "list", "summary", "status", "balance", "balances", "view", "payments", "charges", "history", "info", "overview",
  "transactions", "movements", "debits", "most", "used"]);
const routeWords = (route: string) => route.split(/[/_]/).flatMap((segment) => segment.split(/(?=[A-Z][a-z])/)).map((word) => word.toLowerCase());
const SEGMENT = /^[A-Za-z][A-Za-z_]{0,30}$/;
const WPS_ROOT = "/wps/myportal/FibiMenu/Online/";
// Exactly the shell's own path: nothing before it, so no id or session state rides along.
const SHELL = /^(?:\/appsng)?\/Resources\/PortalNG\/shell\/?$/;
const MAX_SEGMENTS = 12;

/**
 * Run in the page as a fixed string, like officialLogin's DOCUMENT: only links that already point
 * into the signed-in menu, with their label. Anything else on the page (an account picker, her name) stays there.
 */
export const MENU_LINKS = `Array.from(document.querySelectorAll("a[href]")).map((a) => [a.getAttribute("href") || "", (a.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 60)]).filter(([href]) => /^#\\/|PortalNG\\/shell\\/?#\\/|\\/FibiMenu\\/Online\\//.test(href)).slice(0, 300)`;

export interface DepartmentTarget {
  department: SiteDepartment;
  kind: "route" | "page";
  /** Word segments only, joined by "/": safe to log, and the only part of the link that is kept. */
  route: string;
  url: string;
}

function departmentOf(label: string): SiteDepartment | null {
  if (ACTION_LABELS.some((word) => label.includes(word))) return null;
  return SITE_DEPARTMENTS.find((department) => LABELS[department].some((word) => label.includes(word))) ?? null;
}

function wordRoute(path: string): string | null {
  const segments = path.split("/").filter(Boolean);
  if (!segments.length || segments.length > MAX_SEGMENTS || !segments.every((segment) => SEGMENT.test(segment))) return null;
  const route = segments.join("/");
  return routeWords(route).every((word) => VIEW_ROUTE_WORDS.has(word)) ? route : null;
}

/**
 * The menu's own link, taken only when it is already clean: an in-app route (#/…) or a portal page,
 * with no query, session state (!ut/p, ;jsessionid) or anything but word segments. A link that
 * carries state is dropped, not cleaned (§7 clause A).
 */
function targetOf(href: string, base: string, origin: string): Omit<DepartmentTarget, "department"> | null {
  let url: URL;
  try { url = new URL(href, base); } catch { return null; }
  if (url.origin !== origin || url.protocol !== "https:" || url.username || url.password) return null;
  if (url.hash.startsWith("#/") && SHELL.test(url.pathname)) {
    const route = url.search ? null : wordRoute(url.hash.slice(2));
    return route ? { kind: "route", route, url: `${origin}${url.pathname}#/${route}` } : null;
  }
  if (!url.pathname.startsWith(WPS_ROOT) || url.search || url.hash) return null;
  const route = wordRoute(url.pathname.slice(WPS_ROOT.length));
  return route ? { kind: "page", route, url: `${origin}${WPS_ROOT}${route}` } : null;
}

/** At most one target per department, the first verified one in menu order. */
export function menuTargets(links: unknown, base: string): Map<SiteDepartment, DepartmentTarget> {
  const targets = new Map<SiteDepartment, DepartmentTarget>();
  let origin: string;
  try { origin = new URL(base).origin; } catch { return targets; }
  for (const link of Array.isArray(links) ? links.slice(0, 300) : []) {
    if (!Array.isArray(link) || typeof link[0] !== "string" || typeof link[1] !== "string") continue;
    const department = departmentOf(link[1]);
    const target = department && !targets.has(department) ? targetOf(link[0], base, origin) : null;
    if (target && !routeWords(target.route).some((word) => ROUTE_NOUNS[department!].includes(word))) continue;
    if (department && target) targets.set(department, { department, ...target });
  }
  return targets;
}

const routeOf = (url: string, kind: DepartmentTarget["kind"]) => {
  try {
    const parsed = new URL(url);
    return kind === "route" ? parsed.hash.slice(2) : parsed.pathname.slice(WPS_ROOT.length).replace(/\/$/, "");
  } catch { return null; }
};
const MENU_POLL_MS = 2_000;
// By URL and host only: a challenge page is never read to recognise it.
const CHALLENGE = /captcha|challenge|perimeterx|incapsula|imperva|distil|blocked/i;
const SIGN_IN = /login|logon|signin|otp|verif|mataflogin|identif/i;
// The library's success patterns, judged without the query: a login page's returnUrl names the shell too.
const withoutQuery = (url: string) => { try { const u = new URL(url); return `${u.origin}${u.pathname}${u.hash}`; } catch { return url; } };
const MENU_READ_MS = 5_000;

export interface DiscoveryOptions {
  write: (line: string) => void;
  /** Attributes the passive request lines that follow to a department. */
  attribute: (department: SiteDepartment | null) => void;
  signedIn: (url: string) => boolean;
  deadline: number;
  gotoMs?: number;
  settleMs?: number;
  gapMs?: number;
  menuWaitMs?: number;
  /** Only these departments are visited; any other is skipped with no line (a sync's loans-only move). */
  only?: readonly SiteDepartment[];
  /** Told the landed page's URL, so a later read can prove the app is still on it (§7 A2). */
  landed?: (department: SiteDepartment, url: string) => void;
}

type Verdict = { stop: DepartmentStop; all: boolean } | null;

/** Her session still signed in, on the bank's origin, with no sign-in, OTP or challenge in any frame. */
function sessionStop(page: Page, origin: string, signedIn: (url: string) => boolean): Verdict {
  // Chrome's own error page after a failed navigation holds nothing of the bank's: the department failed, not her session.
  if (page.url().startsWith("chrome-error://")) return null;
  const frames = page.frames().map((frame) => withoutQuery(frame.url()));
  if (frames.some((url) => CHALLENGE.test(url))) return { stop: "CHALLENGE", all: true };
  let landedOrigin: string | null = null;
  try { landedOrigin = new URL(page.url()).origin; } catch { /* not a web page */ }
  if (landedOrigin !== origin) return { stop: "CHALLENGE", all: true };
  if (frames.some((url) => SIGN_IN.test(url)) || !signedIn(withoutQuery(page.url()))) return { stop: "SESSION_LOST", all: true };
  return null;
}

/**
 * Checked again right before a read (§7 A2): her window and the same tab still open, no new tab, her
 * session signed in with no challenge, and the app still on the very URL it landed on.
 */
export async function stillLanded(page: Page, landedUrl: string, tabs: number, signedIn: (url: string) => boolean): Promise<DepartmentStop | null> {
  const browser = page.browser();
  if (!browser.connected || page.isClosed()) return "CLOSED";
  if ((await browser.pages().catch(() => [])).length > tabs) return "NEW_TAB";
  let origin: string;
  try { origin = new URL(landedUrl).origin; } catch { return "ERROR"; }
  return sessionStop(page, origin, signedIn)?.stop ?? (page.url() === landedUrl ? null : "REDIRECT");
}

async function verdictAfter(page: Page, browser: Browser, target: DepartmentTarget | null, origin: string, tabs: number, status: number | null, signedIn: (url: string) => boolean): Promise<Verdict> {
  if (!browser.connected || page.isClosed()) return { stop: "CLOSED", all: true };
  if ((await browser.pages().catch(() => [])).length > tabs) return { stop: "NEW_TAB", all: true };
  const session = sessionStop(page, origin, signedIn);
  if (session) return session;
  if (!target) return { stop: "ERROR", all: false };
  // Refused or rate-limited may be the bank's protection noticing us: nothing more is asked of it.
  if (status === 401 || status === 403 || status === 407 || status === 429) return { stop: "HTTP_STATUS", all: true };
  if (status !== null && status >= 400) return { stop: "HTTP_STATUS", all: false };
  // Somewhere else inside the signed-in app may still be a sign-in or OTP step it routed to.
  return routeOf(page.url(), target.kind) === target.route ? null : { stop: "REDIRECT", all: true };
}

/**
 * One pass over the departments, in order, with no retry: a stop that means her session or the bank's
 * protection is involved ends every department still to come.
 */
export async function discoverDepartments(page: Page, options: DiscoveryOptions): Promise<Map<SiteDepartment, DepartmentVisit>> {
  const { write, attribute, signedIn, deadline, gotoMs = 30_000, settleMs = 2_500, gapMs = 2_000, menuWaitMs = 10_000, only, landed } = options;
  const wanted = (department: SiteDepartment) => !only || only.includes(department);
  const visits = new Map<SiteDepartment, DepartmentVisit>();
  const browser = page.browser();
  const origin = new URL(page.url()).origin;
  let links = 0;
  const targets = new Map<SiteDepartment, DepartmentTarget>();
  // The app may draw its menu after it settles: the same read again, up to menuWaitMs, until a department shows.
  const menuUntil = Date.now() + menuWaitMs;
  for (;;) {
    links = 0;
    // The shell may hold its menu in a same-origin frame; each frame's links resolve against its own URL.
    for (const frame of page.frames()) {
      if (!frame.url().startsWith(`${origin}/`)) continue;
      const found: unknown = await Promise.race([frame.evaluate(MENU_LINKS), sleep(MENU_READ_MS).then(() => [])]).catch(() => []);
      links += Array.isArray(found) ? found.length : 0;
      for (const [department, target] of menuTargets(found, frame.url())) if (!targets.has(department)) targets.set(department, target);
    }
    if ([...targets.keys()].some(wanted) || Date.now() >= menuUntil) break;
    await sleep(MENU_POLL_MS);
  }
  write(`menu links=${Math.min(links, 999)} matched=${targets.size}`);
  for (const excluded of EXCLUDED_DEPARTMENTS) write(`dept ${excluded} missing EXCLUDED`);
  let stopAll: DepartmentStop | null = null;
  for (const department of SITE_DEPARTMENTS) {
    if (!wanted(department)) continue;
    const target = targets.get(department);
    if (!target) { visits.set(department, "NOT_IN_MENU"); write(`dept ${department} missing NOT_IN_MENU`); continue; }
    write(`dept ${department} menu ${target.kind} ${target.route}`);
    // Checked again before each move: a sign-out that came after the last settle still ends the pass.
    if (!stopAll) stopAll = sessionStop(page, origin, signedIn)?.stop ?? null;
    if (!stopAll && Date.now() + gotoMs + settleMs > deadline) stopAll = "BUDGET";
    if (stopAll) { visits.set(department, stopAll); write(`dept ${department} missing ${stopAll}`); continue; }
    const tabs = (await browser.pages().catch(() => [])).length;
    attribute(department);
    let verdict: Verdict;
    try {
      const response = await page.goto(target.url, { timeout: gotoMs });
      await sleep(settleMs);
      const status = response?.status() ?? null;
      verdict = await verdictAfter(page, browser, target, origin, tabs, status, signedIn);
    } catch {
      // A failed navigation is judged like a finished one first: it may have ended on a sign-in or challenge.
      verdict = await verdictAfter(page, browser, null, origin, tabs, null, signedIn).catch((): Verdict => ({ stop: "CLOSED", all: true }));
    }
    attribute(null);
    if (verdict?.all) stopAll = verdict.stop;
    visits.set(department, verdict ? verdict.stop : "landed");
    write(verdict ? `dept ${department} missing ${verdict.stop}` : `dept ${department} landed ${target.kind} ${target.route}`);
    if (!verdict) landed?.(department, page.url());
    if (!stopAll) await sleep(gapMs);
  }
  return visits;
}
