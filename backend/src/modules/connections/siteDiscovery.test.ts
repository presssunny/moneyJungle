import puppeteer, { type Browser, type Page } from "puppeteer";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createScraper } from "./officialLogin";
import { PROBE_LINE } from "./probeLog";
import { PROBE_DONE } from "./scraperLaunch";
import { discoverDepartments, menuTargets } from "./siteDiscovery";
// Offline: every request is answered by the test or aborted, so nothing reaches the bank.
import { answerPortal, LOANS, LOANS_DATA, LOGIN_AGAIN, ORIGIN, PORTAL, seenRoutes, shell, signedIn, signedInPage } from "../../testing/mockBankPortal";

describe("menuTargets", () => {
  const base = `${PORTAL}#/Online/Home`;
  const routes = (links: Array<[string, string]>) => Object.fromEntries([...menuTargets(links, base)].map(([department, target]) => [department, `${target.kind} ${target.route} ${target.url}`]));

  it("keeps the menu's department links as word-only routes on the same origin", () => {
    expect(routes([
      [`#/${LOANS}`, "הלוואות ומשכנתאות"],
      ["/wps/myportal/FibiMenu/Online/OnCreditCardsMenu/AuthCreditCardsDetails", "כרטיסי אשראי"],
      ["/appsng/Resources/PortalNG/shell/#/Online/OnStandingOrders/AuthStandingOrders", "הוראות קבע"],
    ])).toEqual({
      loans: `route ${LOANS} ${PORTAL}#/${LOANS}`,
      cards: `page OnCreditCardsMenu/AuthCreditCardsDetails ${ORIGIN}/wps/myportal/FibiMenu/Online/OnCreditCardsMenu/AuthCreditCardsDetails`,
      standing_orders: `route Online/OnStandingOrders/AuthStandingOrders ${ORIGIN}/appsng/Resources/PortalNG/shell/#/Online/OnStandingOrders/AuthStandingOrders`,
    });
    // The one card route public code shows for the new app.
    expect(routes([["#/creditcardCharges", "כרטיסי אשראי"]]).cards).toBe(`route creditcardCharges ${PORTAL}#/creditcardCharges`);
  });

  // §7 clause A: a link that carries a query or session state is dropped, never cleaned and followed.
  it("drops a link with a query or session state instead of stripping it", () => {
    expect(routes([
      ["/wps/myportal/FibiMenu/Online/OnCreditCardsMenu/AuthCreditCardsDetails/!ut/p/z1/04_Sj9CP", "כרטיסי אשראי"],
      ["/wps/myportal/FibiMenu/Online/OnCreditCardsMenu/AuthCreditCardsDetails?x=1", "כרטיסי אשראי"],
      ["/wps/myportal/FibiMenu/Online/OnCreditCardsMenu/AuthCreditCardsDetails;jsessionid=0000AbCd", "כרטיסי אשראי"],
      ["#/Online/OnStandingOrders/AuthStandingOrders?tab=2", "הוראות קבע"],
      [`${PORTAL}?s=1#/Online/OnStandingOrders/AuthStandingOrders`, "הוראות קבע"],
    ])).toEqual({});
  });

  // QA 2026-11-07: anything before the shell's path, a route too long to log, a setup page, a route naming no department.
  it("drops a shell link with a prefix, an overlong route, a setup page or no department in its route", () => {
    expect(routes([
      [`${ORIGIN}/acc/12345678/Resources/PortalNG/shell#/${LOANS}`, "הלוואות"],
      [`${ORIGIN}/x;jsessionid=AbC123/Resources/PortalNG/shell#/${LOANS}`, "הלוואות"],
      [`${ORIGIN}/OnAction/doCancel/Resources/PortalNG/shell/#/${LOANS}`, "הלוואות"],
      [`#/${Array(13).fill("OnLoans").join("/")}`, "הלוואות"],
      ["#/Online/OnStandingOrders/AuthStandingOrders", "הוראות קבע - הקמה"],
      ["#/Online/Auth", "הלוואות"], ["#/Online/My/Main/Home", "הלוואות"],
      ["#/Online/OnLoans/AuthLoans", "שיקים חוזרים"],
    ])).toEqual({});
  });

  // Architect 2026-11-07: the label alone must not pick where the app goes.
  it("drops a department label on a route that names another place", () => {
    expect(routes([["#/Online/OnCurrentAccount/AccountBalance", "הלוואות"], ["#/Online/Home", "פיקדונות"], ["#/Online/OnLoans/AuthLoansDetails", "פיקדונות"]])).toEqual({});
  });

  it("drops a link that acts, carries an identifier, leaves the bank, or names no department", () => {
    expect(routes([
      ["#/Online/OnLoans/LoanRequest", "בקשת הלוואה"],
      ["#/Online/OnLoans/Loan/58213", "הלוואה 12-345678"],
      ["#/Online/OnCheques/OrderChequeBook", "הזמנת פנקס שיקים"],
      ["#/Online/OnCheques/AuthCheques", "ביטול שיקים"],
      ["#/Online/OnDeposits/NewDeposit", "פיקדונות"],
      ["#/Online/OnDeposits/Auth-Deposits", "פיקדונות"],
      ["https://evil.example/wps/myportal/FibiMenu/Online/OnDeposits", "פיקדונות"],
      ["https://user:pw@online.fibi.co.il/wps/myportal/FibiMenu/Online/OnDeposits", "פיקדונות"],
      ["http://online.fibi.co.il/wps/myportal/FibiMenu/Online/OnDeposits", "פיקדונות"],
      ["javascript:openCheques()", "שיקים"],
      ["#/Online/OnTransfers/AuthTransfer", "העברה בין חשבונות"],
      ["/wps/myportal/FibiMenu/Online/Logout", "יציאה"],
      ["/wps/myportal/FibiMenu/Marketing/Private/Home", "הלוואות"],
      ["#/Online/OnLoans/AuthLoans", "מצב החשבון"],
      ["#/", "הלוואות"],
      [42 as unknown as string, "הלוואות"],
    ])).toEqual({});
  });

  // Banker 2026-11-07: action and offer pages a negative word list let through.
  it("visits no repayment, break, request, schedule or offer page, however it is worded", () => {
    expect(routes([
      ["#/Online/OnLoans/EarlyRepayment", "הלוואות"], ["#/Online/OnLoans/LOANREQ", "הלוואות"], ["#/Online/OnLoans/requestloan", "הלוואות"],
      ["#/Online/OnLoans/LoanSchedule", "הלוואות"], ["#/Online/OnLoans/AmortizationSchedule", "הלוואות"], ["#/Online/OnLoans/Payoff", "הלוואות"],
      ["#/Online/OnLoans/AuthLoansDetails", "הלוואה בקליק"], ["#/Online/OnLoans/AuthLoansDetails", "לוח סילוקין להלוואה"], ["#/Online/OnLoans/AuthLoansDetails", "פירעון מוקדם של הלוואה"],
      ["#/Online/OnDeposits/BreakDeposit", "פיקדונות"], ["#/Online/OnDeposits/WithdrawDeposit", "פיקדונות"], ["#/Online/OnDeposits/AuthDeposits", "שבירת פיקדון"],
      ["#/Online/OnDeposits/AuthDeposits", "חיסכון בעמלות"], ["#/Online/OnCheques/DepositCheque", "שיקים"], ["#/Online/OnCards/BlockCard", "כרטיסי אשראי"],
      ["#/Online/OnStandingOrders/AuthStandingOrders", "הקמת הוראת קבע"], ["#/Online/OnCards/IncreaseFrame", "כרטיסי אשראי"],
    ])).toEqual({});
  });

  // Banker 2026-11-07: view labels to keep, and current-account pages that are none of the five departments.
  it("knows the banks' other names for a department, and no account-level page", () => {
    expect(Object.keys(routes([["#/Online/OnDeposits/AuthDeposits", "פק״מ"], ["#/Online/OnCheques/AuthCheques", "המחאות"]])).sort()).toEqual(["cheques", "deposits"]);
    expect(routes([["#/Online/OnCreditCardsMenu/AuthCreditCardsDetails", "פירוט חיובים"], ["#/Online/OnCreditCardsMenu/AuthCreditCardsDetails", "מסגרות אשראי"],
      ["#/Online/OnStandingOrders/AuthStandingOrders", "הרשאות"]])).toEqual({});
  });

  it("takes the first verified link per department, past the ones it dropped", () => {
    expect(routes([["#/Online/OnLoans/LoanRequest", "בקשת הלוואה"], [`#/${LOANS}`, "הלוואות"], ["#/Online/OnLoans/Other", "הלוואות"]]).loans).toBe(`route ${LOANS} ${PORTAL}#/${LOANS}`);
    expect(menuTargets("not a list", base).size).toBe(0);
  });
});

async function discover(portal: string) {
  const requested: string[] = [];
  const lines: string[] = [];
  let libraryPage: Page | null = null;
  const scraper = createScraper({
    startDate: new Date("2026-09-01T00:00:00Z"), defaultTimeout: 2_000, showBrowser: false, loginWaitMs: 15_000,
    probe: (line: string) => lines.push(line), siteDiscovery: true,
    preparePage: async (pageToPrepare: Page) => {
      libraryPage = pageToPrepare;
      await answerPortal(pageToPrepare, portal, requested);
    },
  });
  const progress: string[] = [];
  scraper.onProgress((_company, payload) => {
    progress.push(payload.type);
    // She signs in on the bank's page; here the test plays her part. After that she touches nothing.
    if (payload.type === "LOGGING_IN") setTimeout(() => void libraryPage?.goto(PORTAL), 300);
  });
  const result = await scraper.scrape({} as never);
  const seen = seenRoutes(requested);
  return { result, progress, requested, lines, seen };
}

describe("discoverDepartments (official window, discovery run)", () => {
  it("visits only the menu's verified department pages, stops on what it must, and reads nothing of hers", async () => {
    const { result, progress, requested, lines, seen } = await discover(shell());
    expect(result).toMatchObject({ success: false, errorMessage: PROBE_DONE });
    expect(progress).not.toContain("LOGIN_SUCCESS");
    expect(requested.some((url) => url.includes("OnBalanceTrans"))).toBe(false);
    // In order, once each, and only these: the standing orders page bounced elsewhere, which ends the pass.
    expect(seen).toEqual([LOANS, "Online/OnStandingOrders/AuthStandingOrders", "Online/Home"]);
    for (const never of ["LoanRequest", "58213/", "OrderChequeBook", "AuthTransfer", "Logout", "evil.example", "/__event/", "!ut", "AuthDeposits"]) expect(requested.some((url) => url.includes(never)), never).toBe(false);
    const departments = lines.filter((line) => line.startsWith("dept ") && !/ tab \d /.test(line));
    expect(departments).toEqual([
      "dept loan_schedule missing EXCLUDED",
      `dept loans menu route ${LOANS}`,
      `dept loans landed route ${LOANS}`,
      "dept cards menu page OnCreditCardsMenu/AuthCreditCardsDetails",
      "dept cards missing HTTP_STATUS",
      "dept standing_orders menu route Online/OnStandingOrders/AuthStandingOrders",
      "dept standing_orders missing REDIRECT",
      "dept cheques missing NOT_IN_MENU",
      "dept deposits menu route Online/OnDeposits/AuthDeposits",
      "dept deposits missing REDIRECT",
    ]);
    expect(lines).toContain("menu links=11 matched=4");
    // The app's own data call on the loans page, credited to loans, as a template only.
    expect(lines.some((line) => /^dept loans tab \d POST fetch online\.fibi\.co\.il\/appsng\/bff-loans\/api\/:id\/loans\/:id$/.test(line)), lines.join("\n")).toBe(true);
    for (const line of lines) expect(PROBE_LINE.test(line), line).toBe(true);
    for (const secret of ["דנה", "כהן", "58213", "12-345678", "secret-body", "acct", "שלום", "הלוואות"]) expect(lines.join("\n"), secret).not.toContain(secret);
  }, 90_000);

  it("stops every department still to come when the bank signs her out", async () => {
    const { seen, lines } = await discover(shell(LOANS_DATA, "void 0"));
    expect(seen).toEqual([LOANS, "Online/OnStandingOrders/AuthStandingOrders", "Online/OnDeposits/AuthDeposits"]);
    expect(lines).toContain("dept standing_orders landed route Online/OnStandingOrders/AuthStandingOrders");
    expect(lines).toContain("dept deposits missing SESSION_LOST");
  }, 90_000);

  it("stops every department still to come when the app routes to a sign-in or OTP step of its own", async () => {
    const { seen, lines } = await discover(shell(`location.hash = "#/Online/Login/OtpVerify"`));
    expect(seen).toEqual([LOANS, "Online/Login/OtpVerify"]);
    expect(lines.filter((line) => / missing /.test(line))).toEqual([
      "dept loan_schedule missing EXCLUDED", "dept loans missing SESSION_LOST", "dept cards missing SESSION_LOST",
      "dept standing_orders missing SESSION_LOST", "dept cheques missing NOT_IN_MENU", "dept deposits missing SESSION_LOST",
    ]);
  }, 90_000);

  it("stops every department still to come when a page opens a tab, without retrying", async () => {
    const { result, lines, seen } = await discover(shell(`open("about:blank")`));
    expect(result).toMatchObject({ success: false, errorMessage: PROBE_DONE });
    expect(seen).toEqual([LOANS]);
    expect(lines.filter((line) => / missing /.test(line))).toEqual([
      "dept loan_schedule missing EXCLUDED", "dept loans missing NEW_TAB", "dept cards missing NEW_TAB",
      "dept standing_orders missing NEW_TAB", "dept cheques missing NOT_IN_MENU", "dept deposits missing NEW_TAB",
    ]);
  }, 90_000);
});

// Each stop rule against the real pass, one scenario per page. A portal page answers with the status given;
// "abort" fails the navigation the way a dropped connection does.
describe("discoverDepartments stop rules", () => {
  const W = "/wps/myportal/FibiMenu/Online";
  const DEPOSITS = `${W}/OnDeposits/AuthDeposits`;
  let browser: Browser;
  beforeAll(async () => { browser = await puppeteer.launch({ headless: true }); });
  afterAll(async () => { await browser.close(); });

  async function pass(first: [string, string], pages: Record<string, { status: number; body: string } | "abort">, { script = "", gapMs = 100, waitMs = 0 } = {}) {
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      const plain = request.url().split("?")[0].split("#")[0];
      if (plain === PORTAL) return void request.respond({ status: 200, contentType: "text/html", body: `<meta charset="utf-8"><nav><a href="${first[0]}">${first[1]}</a><a href="${DEPOSITS}">פיקדונות</a></nav><script>${script}</script>` });
      const hit = pages[plain.replace(ORIGIN, "")] ?? (plain === `${ORIGIN}${DEPOSITS}` ? { status: 200, body: "<p>ok</p>" } : undefined);
      if (hit === "abort") return void request.abort();
      if (hit) return void request.respond({ status: hit.status, contentType: "text/html", body: hit.body });
      void (plain.startsWith(ORIGIN) ? request.respond({ status: 200, contentType: "application/json", body: "{}" }) : request.abort());
    });
    await page.goto(PORTAL);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    const lines: string[] = [];
    const started = Date.now();
    const signedIn = (url: string) => [/Resources\/PortalNG\/shell/, /FibiMenu\/Online/].some((pattern) => pattern.test(url));
    await discoverDepartments(page, { write: (line) => lines.push(line), attribute: () => {}, signedIn, deadline: Date.now() + 60_000, settleMs: 1_500, gapMs, menuWaitMs: 0 });
    await page.close();
    return { outcome: lines.filter((line) => / (missing|landed) /.test(line) && !line.includes("NOT_IN_MENU") && !line.includes("EXCLUDED")), seconds: (Date.now() - started) / 1000 };
  }
  const loans = (status: number, body = "<p>x</p>") => ({ [`${W}/OnLoans/AuthLoans`]: { status, body } });
  const LOANS_PAGE: [string, string] = [`${W}/OnLoans/AuthLoans`, "הלוואות"];

  it.each([401, 403, 407, 429])("a %i — possibly the bank's protection — asks nothing more of it", async (status) => {
    expect((await pass(LOANS_PAGE, loans(status))).outcome).toEqual(["dept loans missing HTTP_STATUS", "dept deposits missing HTTP_STATUS"]);
  }, 60_000);

  it("a server error costs only its own department", async () => {
    expect((await pass(LOANS_PAGE, loans(500))).outcome).toEqual(["dept loans missing HTTP_STATUS", `dept deposits landed page OnDeposits/AuthDeposits`]);
  }, 60_000);

  it("a dropped navigation costs only its own department, and is not taken for the bank's protection", async () => {
    expect((await pass(LOANS_PAGE, { [`${W}/OnLoans/AuthLoans`]: "abort" })).outcome).toEqual(["dept loans missing ERROR", `dept deposits landed page OnDeposits/AuthDeposits`]);
  }, 60_000);

  it("a verification step in a frame of the same origin ends the pass", async () => {
    const pages = { ...loans(200, `<iframe src="${ORIGIN}/sec/verify"></iframe>`), "/sec/verify": { status: 200, body: "<p>code</p>" } };
    expect((await pass(LOANS_PAGE, pages)).outcome).toEqual(["dept loans missing SESSION_LOST", "dept deposits missing SESSION_LOST"]);
  }, 60_000);

  it("a sign-out that comes after the page settled still ends the pass before the next department", async () => {
    const pages = { ...loans(200, `<script>setTimeout(() => location.replace("${LOGIN_AGAIN}"), 1700)</script>`), "/MatafLoginService/MatafLoginServlet": { status: 200, body: "<p>login</p>" } };
    // Lands 0.2 s after the settle, well inside the gap before the next department.
    expect((await pass(LOANS_PAGE, pages, { gapMs: 1_500 })).outcome).toEqual(["dept loans landed page OnLoans/AuthLoans", "dept deposits missing SESSION_LOST"]);
  }, 60_000);

  it("a dialog the page left open cannot hold the menu read past its limit", async () => {
    const { outcome, seconds } = await pass(LOANS_PAGE, loans(200, "<p>ok</p>"), { script: `setTimeout(() => alert("x"), 300)`, waitMs: 800 });
    expect(outcome).toEqual([]);
    expect(seconds).toBeLessThan(20);
  }, 60_000);
});

// A sync's loans-only move (design §3.4): the same pass and stop rules, one department, its verdict returned.
describe("discoverDepartments limited to the loans department", () => {
  let browser: Browser;
  beforeAll(async () => { browser = await puppeteer.launch({ headless: true }); });
  afterAll(async () => { await browser.close(); });
  async function loansOnly(portal: string) {
    const { page, requested } = await signedInPage(browser, portal);
    const lines: string[] = [];
    const visits = await discoverDepartments(page, { only: ["loans"], write: (line) => lines.push(line), attribute: () => {}, signedIn, deadline: Date.now() + 60_000, gapMs: 0, menuWaitMs: 0 });
    await page.close();
    return { visits: Object.fromEntries(visits), seen: seenRoutes(requested), requested, lines };
  }

  it("visits only the loans route and returns its verdict; no other department gets a line or a visit", async () => {
    const { visits, seen, requested, lines } = await loansOnly(shell());
    expect(visits).toEqual({ loans: "landed" });
    expect(seen).toEqual([LOANS]);
    expect(lines.filter((line) => line.startsWith("dept ") && !line.includes("loan_schedule"))).toEqual([`dept loans menu route ${LOANS}`, `dept loans landed route ${LOANS}`]);
    for (const never of ["/__event/", "AuthCreditCardsDetails", "AuthStandingOrders", "AuthDeposits", "LoanRequest", "58213/"]) expect(requested.some((url) => url.includes(never)), never).toBe(false);
  }, 60_000);

  it("returns the stop when the loans page signs her out", async () => {
    const { visits, seen } = await loansOnly(shell(`location.replace("${LOGIN_AGAIN}")`));
    expect(visits).toEqual({ loans: "SESSION_LOST" });
    expect(seen).toEqual([LOANS]);
  }, 60_000);

  it("returns NOT_IN_MENU and moves nowhere when the menu has no loans page", async () => {
    const { visits, seen } = await loansOnly(shell().replace(`<a href="#/${LOANS}">הלוואות ומשכנתאות</a>`, ""));
    expect(visits).toEqual({ loans: "NOT_IN_MENU" });
    expect(seen).toEqual([]);
  }, 60_000);

  it("a full discovery pass returns the same verdicts its lines state", async () => {
    const { page } = await signedInPage(browser, shell());
    const lines: string[] = [];
    const visits = await discoverDepartments(page, { write: (line) => lines.push(line), attribute: () => {}, signedIn, deadline: Date.now() + 60_000, gapMs: 100, menuWaitMs: 0 });
    await page.close();
    const stated = Object.fromEntries(lines.flatMap((line) => { const m = /^dept (\w+) (landed|missing (\w+))/.exec(line); return m && m[1] !== "loan_schedule" ? [[m[1], m[3] ?? "landed"]] : []; }));
    expect(Object.fromEntries(visits)).toEqual(stated);
    expect(visits.get("loans")).toBe("landed");
  }, 90_000);
});
