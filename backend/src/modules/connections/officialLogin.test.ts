import { EventEmitter } from "node:events";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import puppeteer, { type Browser, type Page } from "puppeteer";
import { getCurrentUrl } from "israeli-bank-scrapers/lib/helpers/navigation";
import { TimeoutError } from "israeli-bank-scrapers/lib/helpers/waiting";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createScraper, departmentFollowUp, detailsSources, NOT_APPROVED_LOAN_DETAILS, OFFICIAL_LOGIN_URL, probePath, waitForSignIn, type LoanDetailsSource } from "./officialLogin";
import { TABLE_CELLS, TABLE_LOAN_DETAILS, TABLE_STANDING_ORDER_DETAILS } from "./departmentRead";
import { PROBE_LINE } from "./probeLog";
import { MENU_LINKS } from "./siteDiscovery";
import { BROWSER_CLOSED, BROWSER_TAB_CLOSED, LOAN_FOLLOW_UP_MS, PROBE_DONE, PROBE_SIGNED_IN } from "./scraperLaunch";
import { fakeLoanDetails, STUB_LOAN_DIGITS } from "../../testing/fakeLoanDetails";
import { LOANS, LOGIN_AGAIN, ORIGIN, seenRoutes, shell, signedIn as portalSignedIn, signedInPage } from "../../testing/mockBankPortal";

// Offline: every request is answered here or aborted, so nothing reaches the bank.
const PORTAL = "https://online.fibi.co.il/Resources/PortalNG/shell";
const MARKETING_HOME = "https://www.fibi.co.il/wps/portal/FibiMenu/Marketing/Private/Home";
const LOGIN = "https://bank.test/login";
// The real portal passes through this success-looking URL, then redirects to the shell about a second later.
const ONLINE = "https://online.fibi.co.il/wps/myportal/FibiMenu/Online";

async function offline(page: Page, { portal = "<p>page</p>", redirectMs = 1_500 } = {}) {
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    const url = request.url();
    if (url.startsWith(ONLINE)) return void request.respond({ status: 200, contentType: "text/html", body: `<p>portal</p><script>setTimeout(() => location.replace("${PORTAL}"), ${redirectMs})</script>` });
    const known = [PORTAL, MARKETING_HOME, LOGIN].some((prefix) => url.startsWith(prefix));
    void (known ? request.respond({ status: 200, contentType: "text/html", body: url.startsWith(PORTAL) ? portal : "<p>page</p>" }) : request.abort());
  });
  return page;
}

/** A page mid-redirect: an evaluate issued before the shell commits dies with it, as Chrome's does. */
function redirectingPage(navigateAfterMs: number) {
  const events = new EventEmitter();
  const mainFrame = {};
  const navigateAt = Date.now() + navigateAfterMs;
  let url = ONLINE;
  setTimeout(() => { url = `${PORTAL}/`; events.emit("framenavigated", mainFrame); }, navigateAfterMs);
  const page = {
    url: () => url,
    isClosed: () => false,
    mainFrame: () => mainFrame,
    on: (event: string, listener: (...args: unknown[]) => void) => { events.on(event, listener); return page; },
    off: (event: string, listener: (...args: unknown[]) => void) => { events.off(event, listener); return page; },
    browser: () => ({ connected: true, pages: async () => [page] }),
    waitForSelector: () => new Promise(() => {}),
    // A string is officialLogin's own read (href + document), a function the library's getCurrentUrl.
    evaluate: (read: unknown) => new Promise((resolve, reject) => {
      const wait = navigateAt - Date.now();
      if (wait <= 0) resolve(typeof read === "string" ? [url, navigateAt] : url);
      else setTimeout(() => reject(new Error("Execution context was destroyed, most likely because of a navigation.")), wait);
    }),
  };
  return page as unknown as Page;
}

let browser: Browser;
let page: Page;
beforeEach(async () => {
  browser = await puppeteer.launch({ headless: true });
  page = await offline(await browser.newPage());
  await page.goto(LOGIN);
});
afterEach(async () => { if (browser.connected) await browser.close(); });

describe("probePath", () => {
  it("keeps a template of host and path: no query, fragment, portal state or opaque token", () => {
    expect(probePath("https://online.fibi.co.il/MatafLoginService/MatafLoginServlet?bankId=FIBIPORTAL&site=Private#tok=abc")).toBe("online.fibi.co.il/MatafLoginService/MatafLoginServlet");
    expect(probePath("https://online.fibi.co.il/wps/myportal/FibiMenu/Online/!ut/p/z1/04_Sj9CPykssy0xPLMnMz0vMAfI")).toBe("online.fibi.co.il/wps/myportal/FibiMenu/Online/");
    expect(probePath(`https://online.fibi.co.il/session/${"a1".repeat(30)}/home`)).toBe("online.fibi.co.il/session/:id/home");
    expect(probePath("https://online.fibi.co.il/acc/031/branch/123/loan/987")).toBe("online.fibi.co.il/acc/:id/branch/:id/loan/:id");
    expect(probePath("https://online.fibi.co.il/wps/portal/home;jsessionid=0000AbCdEfGhIj:1a2b3c4d")).toBe("online.fibi.co.il/wps/portal/home");
    expect(probePath("https://tok-AbCdEf9876.fibi.co.il/x")).toBe(":id.fibi.co.il/x");
    for (const other of ["about:blank", "data:text/html,<p>x</p>", "chrome-error://chromewebdata/", "not a url", "blob:https://online.fibi.co.il/9f2c1d3a-aaaa"]) expect(probePath(other)).toBeNull();
  });

  // QA's hostile set (2026-11-07): account and branch digits, SSO codes, base64, jsessionid, encoded names.
  const SECRETS = ["12345678", "012-345678", "031", "123", "987", "AB12C", "ID0123A9", "12345678X", "דנה", "%D7%93", "eyJhbGci", "abcdefghijklmnopqrstuvwxyz0123456789",
    "dGhpc2lzYXNlY3JldHRva2Vu", "jsessionid", "0000AbCd", "1a2b3c4d", "SECRET", "Pw9x", "dana@gmail.com", "3a7f9c1e", "AbCdEf9876", "482913", "482", "a=1"];
  const HOSTILE = [
    "https://online.fibi.co.il/loans/12345678", "https://online.fibi.co.il/acc/012-345678/details", "https://online.fibi.co.il/acc/031/branch/123/loan/987",
    "https://online.fibi.co.il/acct/AB12C/cust/ID0123A9", "https://online.fibi.co.il/acct/12345678X/view", "https://online.fibi.co.il/p/דנה_כהן/x",
    "https://online.fibi.co.il/p/%D7%93%D7%A0%D7%94/x", "https://sso.fibi.co.il/auth/code/eyJhbGciOiJIUzI1NiJ9xyzAB/cb",
    "https://sso.fibi.co.il/auth/eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkifQ.abcdefghijklmnopqrstuvwxyz0123456789/cb",
    "https://online.fibi.co.il/s/dGhpc2lzYXNlY3JldHRva2Vu/home", "https://online.fibi.co.il/wps/portal/home;jsessionid=0000AbCdEfGhIj:1a2b3c4d",
    "https://online.fibi.co.il/wps/portal;jsessionid=0000AbCdEfGh/x", "https://online.fibi.co.il/wps/myportal/FibiMenu/Online/!ut/p/z1/04_Sj9CPykssy0xP",
    "https://online.fibi.co.il/wps/myportal/a%21ut/p/z1/SECRET", "https://user:Pw9x@online.fibi.co.il/x", "https://online.fibi.co.il/u/dana@gmail.com/x",
    "https://3a7f9c1e-1111-2222-3333-444455556666.idp.example.com/login", "https://tok-AbCdEf9876.fibi.co.il/x", "https://online.fibi.co.il/otp/482913",
    "https://online.fibi.co.il/otp/482", "data:text/html,secret", "blob:https://online.fibi.co.il/9f2c1d3a-aaaa-bbbb-cccc-1234567890ab",
    "https://online.fibi.co.il/%2e%2e/a b/x", "http://online.fibi.co.il/x?a=1#f",
  ];

  it("lets none of QA's 24 hostile URLs through: no digit, token, session id, name or encoded text", () => {
    expect(HOSTILE).toHaveLength(24);
    for (const url of HOSTILE) {
      const template = probePath(url);
      if (template === null) continue;
      expect(template.replaceAll(":id", ""), url).not.toMatch(/[\d;=%@?#!:]/);
      for (const secret of SECRETS) expect(template.toLowerCase(), url).not.toContain(secret.toLowerCase());
      expect(PROBE_LINE.test(`tab 1 page ${template}`), url).toBe(true);
    }
  });
});

describe("waitForSignIn", () => {
  it("returns once her window reaches the bank's logged-in area", async () => {
    const waiting = waitForSignIn(page, 15_000);
    setTimeout(() => void page.goto(PORTAL), 500);
    await expect(waiting).resolves.toBeUndefined();
  }, 30_000);

  it("waits out the portal's redirect, so the library's next read of the page cannot die mid-navigation", async () => {
    const page = redirectingPage(1_000);
    await waitForSignIn(page, 15_000);
    await expect(getCurrentUrl(page, true)).resolves.toMatch(/PortalNG\/shell/);
  }, 30_000);

  it("returns only once a real Chrome window has left the intermediate portal page", async () => {
    await page.close();
    page = await offline(await browser.newPage(), { portal: "<div id=account_num>account</div>" });
    await page.goto(LOGIN);
    const waiting = waitForSignIn(page, 15_000);
    setTimeout(() => void page.goto(ONLINE), 300);
    await waiting;
    expect(page.url()).toMatch(/PortalNG\/shell/);
    await expect(getCurrentUrl(page, true)).resolves.toMatch(/PortalNG\/shell/);
  }, 30_000);

  it("is not kept waiting by the portal's own in-page routing, which loads no new document", async () => {
    await page.close();
    const routing = `<p>shell</p><script>let n = 0; setInterval(() => history.pushState({}, "", "${PORTAL}/view" + n++), 300)</script>`;
    page = await offline(await browser.newPage(), { portal: routing });
    await page.goto(LOGIN);
    const started = Date.now();
    const waiting = waitForSignIn(page, 15_000);
    setTimeout(() => void page.goto(PORTAL), 300);
    await waiting;
    expect(Date.now() - started).toBeLessThan(10_000);
  }, 40_000);

  it("keeps waiting when another tab she opened closes, instead of failing her sign-in", async () => {
    const tab = await offline(await browser.newPage());
    const waiting = waitForSignIn(page, 15_000);
    await tab.goto(ONLINE);
    setTimeout(() => void tab.close(), 500);
    setTimeout(() => void page.goto(PORTAL), 4_000);
    await expect(waiting).resolves.toBeUndefined();
  }, 40_000);

  it("does not lose a sign-in completed in the last moments of her wait to the settling time", async () => {
    const waiting = waitForSignIn(page, 2_000);
    setTimeout(() => void page.goto(ONLINE), 1_500);
    await expect(waiting).resolves.toBeUndefined();
    expect(page.url()).toMatch(/PortalNG\/shell/);
  }, 30_000);

  it("also notices a sign-in that opened in another tab", async () => {
    const waiting = waitForSignIn(page, 15_000);
    const tab = await offline(await browser.newPage());
    await tab.goto(PORTAL);
    await expect(waiting).resolves.toBeUndefined();
  }, 30_000);

  it("does not take the bank's public home page for a sign-in, and gives up with the library's TimeoutError", async () => {
    await page.goto(MARKETING_HOME);
    await expect(waitForSignIn(page, 2_500)).rejects.toBeInstanceOf(TimeoutError);
  }, 30_000);

  it("tells the library's tab closing apart from the whole window closing", async () => {
    await browser.newPage();
    const waiting = waitForSignIn(page, 15_000);
    setTimeout(() => void page.close(), 500);
    await expect(waiting).rejects.toThrow(BROWSER_TAB_CLOSED);
  }, 30_000);

  it("reports a window she closed", async () => {
    const waiting = waitForSignIn(page, 15_000);
    setTimeout(() => void browser.close(), 500);
    await expect(waiting).rejects.toThrow(BROWSER_CLOSED);
  }, 30_000);
});

describe("connections source (CLAUDE.md §7)", () => {
  // Anything that can act on a bank page: type, click, run code in it, navigate it, copy what it shows
  // (a QR code included), touch its cookies or headers, or reach Chrome's protocol directly.
  const ACTIONS = "click|type|fill|focus|select|tap|hover|press|evaluate|evaluateHandle|evaluateOnNewDocument|\\$eval|\\$\\$eval|waitForFunction|goto|reload|goBack|goForward|setContent|content|screenshot|pdf|addScriptTag|addStyleTag|exposeFunction|setCookie|cookies|deleteCookie|uploadFile|setRequestInterception|setExtraHTTPHeaders|setUserAgent|setJavaScriptEnabled|authenticate|setBypassCSP|createCDPSession|setDownloadBehavior|waitForNavigation|scrollIntoView|scrollTo|scrollBy|drag|dragAndDrop|drop";
  const PAGE_ACTION = new RegExp(`\\.(${ACTIONS})\\s*\\(|\\[\\s*["'\`](${ACTIONS})["'\`]\\s*\\]|\\.(keyboard|mouse|touchscreen)\\b`);
  // The reads the official window needs, by content and once each:
  // the URL and document identity of her tab, and re-opening that same URL in the library's tab.
  const ALLOWED = new Map([
    ["officialLogin.ts", ["const value: unknown = await page.evaluate(DOCUMENT);", "await page.goto(tab.url());"]],
    // §7 clause A: the menu's links, read as a fixed string, and a move to a verified department page.
    ["siteDiscovery.ts", ["const found: unknown = await Promise.race([frame.evaluate(MENU_LINKS), sleep(MENU_READ_MS).then(() => [])]).catch(() => []);", "const response = await page.goto(target.url, { timeout: gotoMs });"]],
    // §7 A2: the tables' cell text on a landed department page, read as a fixed string.
    ["departmentRead.ts", ["const found: unknown = await Promise.race([frame.evaluate(TABLE_CELLS), sleep(FRAME_READ_MS).then(() => [])]).catch(() => []);"]],
  ]);
  const sources = readdirSync(__dirname).filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"));

  it("catches the patterns it is meant to catch", () => {
    for (const line of ['await page.goto("https://bank.test")', "await frame.evaluate(() => 1)", 'page.$eval("#id", (e) => e)', "await page.waitForFunction(() => true)",
      'await page.type("#user", id)', "await page.setExtraHTTPHeaders({})", "page.keyboard.press('Enter')", 'await page.locator("#id").fill(id)',
      "await page.screenshot()", "const cdp = await page.createCDPSession()", 'await page["click"]("#login")', "await page.content()", "await page.reload()"]) {
      expect(PAGE_ACTION.test(line), line).toBe(true);
    }
    expect(PAGE_ACTION.test("const pages = await page.browser().pages()")).toBe(false);
  });

  it("no connection file acts on a bank page beyond the allowed lines", () => {
    const found: string[] = [];
    const allowedSeen = new Map<string, number>();
    for (const name of sources) {
      readFileSync(path.join(__dirname, name), "utf8").split("\n").forEach((line, i) => {
        if (!PAGE_ACTION.test(line)) return;
        const text = line.trim();
        if (ALLOWED.get(name)?.includes(text)) allowedSeen.set(text, (allowedSeen.get(text) ?? 0) + 1);
        else found.push(`${name}:${i + 1}: ${text}`);
      });
    }
    expect(found).toEqual([]);
    expect([...allowedSeen.values()].every((count) => count === 1)).toBe(true);
  });

  it("the department pass reads the menu's links and its own navigation's status — no request, response body, header or listener", () => {
    const source = readFileSync(path.join(__dirname, "siteDiscovery.ts"), "utf8");
    // Only anchors already pointing into the signed-in menu, and only their href and label.
    expect(MENU_LINKS).toBe(String.raw`Array.from(document.querySelectorAll("a[href]")).map((a) => [a.getAttribute("href") || "", (a.textContent || "").replace(/\s+/g, " ").trim().slice(0, 60)]).filter(([href]) => /^#\/|PortalNG\/shell\/?#\/|\/FibiMenu\/Online\//.test(href)).slice(0, 300)`);
    expect(source).not.toMatch(/\.(postData|fetchPostData|hasPostData|headers|request|redirectChain|continue|abort|respond|buffer|text|json|on|once|addListener|newPage|close)\s*\(/);
    expect(source).not.toMatch(/\bfetch\b|XMLHttpRequest|authSSO|apps\.fibi|cookie|localStorage|sessionStorage|waitForResponse|waitForRequest|globalThis|require\(/i);
    // A value's method by name (page["on"]), not a type's member (Target["kind"]).
    expect(source).not.toMatch(/\b[a-z]\w*\s*\??\.?\[\s*["'`]/);
    expect([...source.matchAll(/\.status\(\)/g)]).toHaveLength(1);
  });

  // §7 A2: what runs in a bank page is one of three fixed strings, never a function or a built string.
  it("every page read in the worker runs a fixed exported constant", () => {
    const args = sources.flatMap((name) => [...readFileSync(path.join(__dirname, name), "utf8").matchAll(/\.evaluate\s*\(\s*([^)]*)\)/g)].map((match) => `${name}:${match[1]}`));
    expect(args.sort()).toEqual(["departmentRead.ts:TABLE_CELLS", "officialLogin.ts:DOCUMENT", "siteDiscovery.ts:MENU_LINKS"]);
    expect(TABLE_CELLS).toBe(String.raw`Array.from(document.querySelectorAll("table")).slice(0, 20).map((t) => Array.from(t.rows).slice(0, 200).map((r) => Array.from(r.cells).slice(0, 12).map((c) => !c.getClientRects().length || c.querySelector("input, select, textarea, button, [contenteditable]") ? "" : (c.innerText || "").replace(/\s+/g, " ").trim().slice(0, 80))))`);
    // Nothing in the read reaches a value, the network, storage or the page's state.
    expect(TABLE_CELLS).not.toMatch(/\.value|fetch|XMLHttp|cookie|storage|location|\.click|scroll|dispatch|submit|focus|innerHTML|outerHTML/i);
  });

  it("the window-side modules import only what they need, and nothing dynamically or by reflection", () => {
    const allowed: Record<string, string[]> = {
      "siteDiscovery.ts": ["puppeteer", "israeli-bank-scrapers/lib/helpers/waiting", "./siteDepartments"],
      "officialLogin.ts": ["israeli-bank-scrapers/lib/scrapers/beinleumi", "israeli-bank-scrapers/lib/scrapers/base-beinleumi-group", "israeli-bank-scrapers/lib/scrapers/base-scraper-with-browser",
        "israeli-bank-scrapers/lib/helpers/waiting", "puppeteer", "./providers", "./scraperLaunch", "./departmentRead", "./departmentRead", "./siteDepartments", "./siteDiscovery"],
      "siteDepartments.ts": [],
      "departmentRead.ts": ["puppeteer", "israeli-bank-scrapers/lib/helpers/waiting", "./departmentTables.parser", "./siteDepartments"],
      "departmentTables.parser.ts": ["../../types/connections.types"],
    };
    for (const [name, modules] of Object.entries(allowed)) {
      const source = readFileSync(path.join(__dirname, name), "utf8");
      expect([...source.matchAll(/\bfrom\s+["'`]([^"'`]+)["'`]/g)].map((match) => match[1]).sort(), name).toEqual([...modules].sort());
      expect(source, name).not.toMatch(/\bimport\s*\(|\brequire\s*\(|\bReflect\.|\]\s*\(/);
    }
  });

  it("no window-side module reaches the network itself: no fetch, HTTP module or global lookup", () => {
    for (const name of ["officialLogin.ts", "siteDiscovery.ts", "siteDepartments.ts", "departmentRead.ts", "departmentTables.parser.ts"]) {
      const source = readFileSync(path.join(__dirname, name), "utf8");
      expect(source, name).not.toMatch(/\bfetch\s*\(|node:https?|from\s+["'`]https?["'`]|\b(?:axios|undici)\b|XMLHttpRequest|WebSocket|globalThis/);
    }
  });

  it("the probe reads a request's URL, method and type only — never its body, headers or response", () => {
    const source = readFileSync(path.join(__dirname, "officialLogin.ts"), "utf8");
    expect(new Set([...source.matchAll(/\brequest\.(\w+)/g)].map((match) => match[1]))).toEqual(new Set(["resourceType", "url", "method"]));
    expect(source).not.toMatch(/\.(postData|fetchPostData|hasPostData|headers|response|redirectChain|continue|abort|respond|interceptResolutionState|failure|initiator|buffer|text|json)\s*\(/);
    // No listener on what a response, console or dialog carries: only navigation, requests and tab/window lifetime.
    const events = new Set([...source.matchAll(/\.(?:on|once)\(\s*["'`](\w+)["'`]/g)].map((match) => match[1]));
    expect(events).toEqual(new Set(["framenavigated", "request", "close", "targetcreated", "disconnected"]));
  });

  it("the document read is a read: the URL and the document's identity, nothing else", () => {
    const source = readFileSync(path.join(__dirname, "officialLogin.ts"), "utf8");
    expect(source).toContain('const DOCUMENT = "[location.href, performance.timeOrigin]";');
  });
});

describe("createScraper (official window)", () => {
  it("opens the bank's own page, fills and clicks nothing, and hands her signed-in session to the library's fetch", async () => {
    const requested: string[] = [];
    let libraryPage: Page | null = null;
    let started = 0;
    // The login page reports any fill, click, key or focus on it; the request is recorded, then aborted.
    const recorder = `<script>for (const type of ["input", "change", "click", "keydown", "submit", "focusin"]) addEventListener(type, () => fetch("https://bank.test/__event/" + type), true)</script>`;
    const scraper = createScraper({
      startDate: new Date("2026-09-01T00:00:00Z"), defaultTimeout: 2_000, showBrowser: false, loginWaitMs: 15_000,
      // The worker's signal that Chrome is up; officialLogin hooks the same callback and must pass it on.
      prepareBrowser: async () => { started += 1; },
      preparePage: async (pageToPrepare: Page) => {
        libraryPage = pageToPrepare;
        await pageToPrepare.setRequestInterception(true);
        pageToPrepare.on("request", (request) => {
          requested.push(request.url());
          void (request.isNavigationRequest() ? request.respond({ status: 200, contentType: "text/html", body: `<form><input id=username><input id=password type=password></form>${recorder}` }) : request.abort());
        });
      },
    });
    const progress: string[] = [];
    scraper.onProgress((_company, payload) => {
      progress.push(payload.type);
      // She signs in on the bank's page; here the test plays her part.
      if (payload.type === "LOGGING_IN") setTimeout(() => void libraryPage?.goto(PORTAL), 300);
    });
    const result = await scraper.scrape({} as never);
    expect(requested[0]).toBe(OFFICIAL_LOGIN_URL);
    expect(started).toBe(1);
    expect(requested.filter((url) => url.includes("/__event/"))).toEqual([]);
    expect(progress).toEqual(expect.arrayContaining(["LOGGING_IN", "LOGIN_SUCCESS"]));
    // The fake portal has no account data, so the library's own fetch fails after login — proof it got that far.
    expect(requested.some((url) => url.includes("OnBalanceTrans"))).toBe(true);
    expect(result.success).toBe(false);
  }, 60_000);

  it("follows a sign-in she completed in another tab, instead of judging the login by the first tab", async () => {
    let libraryPage: Page | null = null;
    const answer = (pageToServe: Page) => pageToServe.on("request", (request) => {
      void (request.isNavigationRequest() ? request.respond({ status: 200, contentType: "text/html", body: "<p>page</p>" }) : request.abort());
    });
    const scraper = createScraper({
      startDate: new Date("2026-09-01T00:00:00Z"), defaultTimeout: 2_000, showBrowser: false, loginWaitMs: 15_000,
      preparePage: async (pageToPrepare: Page) => { libraryPage = pageToPrepare; await pageToPrepare.setRequestInterception(true); answer(pageToPrepare); },
    });
    const progress: string[] = [];
    scraper.onProgress((_company, payload) => {
      progress.push(payload.type);
      if (payload.type !== "LOGGING_IN" || !libraryPage) return;
      void (async () => {
        const tab = await libraryPage!.browser().newPage();
        await tab.setRequestInterception(true);
        answer(tab);
        await tab.goto(PORTAL);
      })();
    });
    await scraper.scrape({} as never);
    expect(progress).toContain("LOGIN_SUCCESS");
    expect(progress).not.toContain("LOGIN_FAILED");
  }, 60_000);

  it("in a probe run, records her window's requests as templates and never lets the library read her account", async () => {
    const requested: string[] = [];
    const lines: string[] = [];
    let libraryPage: Page | null = null;
    // The portal posts account details the way the real site's data calls do.
    const portal = `<p>portal</p><script>fetch("https://online.fibi.co.il/api/loans/58213?acct=12-345678#t", { method: "POST", body: "secret-body-9f", headers: { "X-Token": "hdr-tok-77" } }); fetch("https://evilfibi.co.il/steal/path")</script>`;
    const scraper = createScraper({
      startDate: new Date("2026-09-01T00:00:00Z"), defaultTimeout: 2_000, showBrowser: false, loginWaitMs: 15_000,
      probe: (line: string) => lines.push(line),
      preparePage: async (pageToPrepare: Page) => {
        libraryPage = pageToPrepare;
        await pageToPrepare.setRequestInterception(true);
        pageToPrepare.on("request", (request) => {
          requested.push(request.url());
          void (request.isNavigationRequest() ? request.respond({ status: 200, contentType: "text/html", body: request.url().startsWith(PORTAL) ? portal : "<p>login</p>" }) : request.respond({ status: 200, body: "{}" }));
        });
      },
    });
    const progress: string[] = [];
    scraper.onProgress((_company, payload) => {
      progress.push(payload.type);
      if (payload.type === "LOGGING_IN") setTimeout(() => void libraryPage?.goto(PORTAL), 300);
      // Signed in: she looks around, then closes the window herself.
      if (String(payload.type) === PROBE_SIGNED_IN) setTimeout(() => void libraryPage?.browser().close(), 500);
    });
    const result = await scraper.scrape({} as never);
    expect(result).toMatchObject({ success: false, errorMessage: PROBE_DONE });
    expect(progress).toContain("PROBE_SIGNED_IN");
    expect(progress).not.toContain("LOGIN_SUCCESS");
    expect(requested.some((url) => url.includes("OnBalanceTrans"))).toBe(false);
    // Tabs are numbered as Chrome reports them, so the library's tab may be 1 or 2.
    expect(lines.some((line) => /^tab \d POST fetch online\.fibi\.co\.il\/api\/loans\/:id$/.test(line)), lines.join("\n")).toBe(true);
    // Not the bank's domain, only a name ending like it: host alone.
    expect(lines.some((line) => /^tab \d GET fetch evilfibi\.co\.il$/.test(line)), lines.join("\n")).toBe(true);
    for (const line of lines) expect(PROBE_LINE.test(line), line).toBe(true);
    for (const secret of ["steal", "58213", "12-345678", "secret-body", "hdr-tok", "acct", "#t"]) expect(lines.join("\n"), secret).not.toContain(secret);
  }, 60_000);
});

describe("the follow-up's guards (CLAUDE.md §7 A2 approved, B not)", () => {
  const SRC = path.resolve(__dirname, "../..");
  const sourcesUnder = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? sourcesUnder(full) : entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [full] : [];
  });

  it("the worker never passes a details source, only the read list, so a real sync reads with the fixed table read or not at all", () => {
    const worker = readFileSync(path.join(__dirname, "scraperWorker.ts"), "utf8");
    expect(worker).not.toMatch(/loanDetails|standingOrderDetails|TABLE_/);
    expect(worker).toContain("command.options.departmentRead.filter(isReadableDepartment)");
  });

  it("a department outside the read list answers NOT_APPROVED; only a listed one gets the table read", () => {
    expect(detailsSources({})).toEqual({ loanDetails: NOT_APPROVED_LOAN_DETAILS, standingOrderDetails: NOT_APPROVED_LOAN_DETAILS });
    expect(detailsSources({ departmentRead: ["standing_orders", "cards", "deposits", 1] })).toEqual({ loanDetails: NOT_APPROVED_LOAN_DETAILS, standingOrderDetails: TABLE_STANDING_ORDER_DETAILS });
    expect(detailsSources({ departmentRead: ["loans", "standing_orders"] })).toEqual({ loanDetails: TABLE_LOAN_DETAILS, standingOrderDetails: TABLE_STANDING_ORDER_DETAILS });
  });

  it("no source outside the test support imports the fake details source", () => {
    const testing = path.join(SRC, "testing");
    const importers = sourcesUnder(SRC).filter((file) => !file.startsWith(testing) && /fakeLoanDetails/.test(readFileSync(file, "utf8")));
    expect(importers).toEqual([]);
  });

  it("the shipped details step answers without touching the page at all", async () => {
    const untouchable = new Proxy({}, { get: (_target, key) => { throw new Error(`page.${String(key)} touched`); } }) as unknown as Page;
    await expect(NOT_APPROVED_LOAN_DETAILS.read(untouchable, Date.now() + 1_000)).resolves.toEqual({ status: "NOT_APPROVED" });
  });
});

describe("departmentFollowUp, before any move", () => {
  // Any read of the page is recorded and fails: these paths must decide without the bank's app.
  const touched: string[] = [];
  const untouchable = new Proxy({}, { get: (_target, key) => { touched.push(String(key)); throw new Error("page touched"); } }) as unknown as Page;
  const run = (decide: Parameters<typeof departmentFollowUp>[2]["decide"], budgetMs = 5_000) => {
    const details = fakeLoanDetails("one");
    touched.length = 0;
    return departmentFollowUp(untouchable, { success: true }, { decide, signedIn: () => true, loanDetails: details, budgetMs }).then((extras) => ({ extras, reads: details.calls, touched: [...touched] }));
  };

  it("no department wanted: no move, no read", async () => {
    expect(await run(async () => ({ loans: false, standingOrders: false }))).toEqual({ extras: { followUp: { department: "NOT_NEEDED", details: "NOT_RUN", standingOrders: { department: "NOT_NEEDED", details: "NOT_RUN" } } }, reads: 0, touched: [] });
  });

  it("the worker's own wait ran out: no decision, no move", async () => {
    expect(await run(async () => ({ loans: true, standingOrders: true, timedOut: true }))).toEqual({ extras: { followUp: { department: "NO_DECISION", details: "NOT_RUN", standingOrders: { department: "NO_DECISION", details: "NOT_RUN" } } }, reads: 0, touched: [] });
  });

  it("a decision that never comes is cut at the budget", async () => {
    const started = Date.now();
    expect(await run(() => new Promise(() => {}), 1_500)).toEqual({ extras: { followUp: { department: "NO_DECISION", details: "NOT_RUN", standingOrders: { department: "NO_DECISION", details: "NOT_RUN" } } }, reads: 0, touched: [] });
    expect(Date.now() - started).toBeLessThan(1_500 + 2_000);
  });

  it("never throws: a failing decision or move is a report, not an error", async () => {
    expect((await run(async () => { throw new Error("ipc"); })).extras).toEqual({ followUp: { department: "ERROR", details: "FAILED", standingOrders: { department: "ERROR", details: "NOT_RUN" } } });
    const moved = await run(async () => ({ loans: true, standingOrders: true }));
    expect(moved.extras).toEqual({ followUp: { department: "ERROR", details: "FAILED", standingOrders: { department: "ERROR", details: "FAILED" } } });
    expect(moved.reads).toBe(0);
  });

  it("the budget holds two departments: 120 seconds", () => {
    expect(LOAN_FOLLOW_UP_MS).toBe(120_000);
  });
});

// Against the offline portal: the library's tab already signed in on the shell, as after the checking fetch.
describe("departmentFollowUp in the bank's app (official window, offline)", () => {
  const yes = async () => ({ loans: true });
  async function follow(portal: string, loanDetails: LoanDetailsSource, budgetMs = LOAN_FOLLOW_UP_MS) {
    const { page: signed, requested } = await signedInPage(browser, portal);
    const started = Date.now();
    const extras = await departmentFollowUp(signed, { success: true }, { decide: yes, signedIn: portalSignedIn, loanDetails, budgetMs });
    return { extras, seconds: (Date.now() - started) / 1000, seen: seenRoutes(requested), requested, url: signed.url() };
  }

  it("moves only to the menu's loans page, in the same tab, and hands back what the details step read", async () => {
    const details = fakeLoanDetails("one");
    const tabsBefore = (await browser.pages()).length;
    const { extras, seen, requested, url } = await follow(shell(), details);
    expect(extras).toEqual({ loans: [STUB_LOAN_DIGITS], followUp: { department: "landed", details: "READ", standingOrders: { department: "NOT_NEEDED", details: "NOT_RUN" } } });
    expect(details.calls).toBe(1);
    expect(seen).toEqual([LOANS]);
    expect(url).toBe(`${PORTAL}#/${LOANS}`);
    expect((await browser.pages()).length).toBe(tabsBefore + 1);
    // Nothing clicked, typed or focused; no other department, no action or identifier link, nothing off the bank's origin.
    for (const never of ["/__event/", "LoanRequest", "58213/", "AuthCreditCardsDetails", "AuthStandingOrders", "AuthDeposits", "Logout", "evil.example"]) expect(requested.some((u) => u.includes(never)), never).toBe(false);
    expect(requested.every((u) => u.startsWith(`${ORIGIN}/`))).toBe(true);
  }, 60_000);

  it("with the shipped details step, lands and reads nothing", async () => {
    expect((await follow(shell(), NOT_APPROVED_LOAN_DETAILS)).extras).toEqual({ followUp: { department: "landed", details: "NOT_APPROVED", standingOrders: { department: "NOT_NEEDED", details: "NOT_RUN" } } });
  }, 60_000);

  it("stops when the loans page signs her out, and never runs the details step", async () => {
    const details = fakeLoanDetails("one");
    const { extras, seen } = await follow(shell(`location.replace("${LOGIN_AGAIN}?returnUrl=/Resources/PortalNG/shell")`), details);
    expect(extras).toEqual({ followUp: { department: "SESSION_LOST", details: "NOT_RUN", standingOrders: { department: "NOT_NEEDED", details: "NOT_RUN" } } });
    expect(details.calls).toBe(0);
    expect(seen).toEqual([LOANS]);
  }, 60_000);

  it("does not move at all when the budget left cannot hold a navigation", async () => {
    const details = fakeLoanDetails("one");
    const { extras, seen } = await follow(shell(), details, 10_000);
    expect(extras).toEqual({ followUp: { department: "BUDGET", details: "NOT_RUN", standingOrders: { department: "NOT_NEEDED", details: "NOT_RUN" } } });
    expect(seen).toEqual([]);
    expect(details.calls).toBe(0);
  }, 60_000);

  it("a details step that hangs is cut at the budget, and the follow-up still returns", async () => {
    const { extras, seconds } = await follow(shell(), fakeLoanDetails("hang"), 40_000);
    expect(extras).toEqual({ followUp: { department: "landed", details: "FAILED", standingOrders: { department: "NOT_NEEDED", details: "NOT_RUN" } } });
    expect(seconds).toBeLessThan(40 + 2);
  }, 90_000);

  it("a details step that throws is a FAILED report", async () => {
    expect((await follow(shell(), fakeLoanDetails("throws"))).extras).toEqual({ followUp: { department: "landed", details: "FAILED", standingOrders: { department: "NOT_NEEDED", details: "NOT_RUN" } } });
  }, 60_000);
});

describe("createScraper with the loans flag", () => {
  it("leaves the library's fetch untouched without the flag, and in a probe run even with it", () => {
    const own = (options: Parameters<typeof createScraper>[0]) => Object.prototype.hasOwnProperty.call(createScraper(options), "fetchData");
    const base = { startDate: new Date("2026-09-01T00:00:00Z"), defaultTimeout: 2_000, showBrowser: false, loginWaitMs: 15_000 };
    expect(own(base)).toBe(false);
    expect(own({ ...base, probe: () => {}, decideFollowUp: async () => ({ loans: true }) })).toBe(false);
    expect(own({ ...base, decideFollowUp: async () => ({ loans: true }) })).toBe(true);
  });

  it("never asks when the checking fetch failed: the follow-up runs only after real checking rows", async () => {
    let libraryPage: Page | null = null;
    const asked: unknown[] = [];
    const scraper = createScraper({
      startDate: new Date("2026-09-01T00:00:00Z"), defaultTimeout: 2_000, showBrowser: false, loginWaitMs: 15_000,
      decideFollowUp: async (checking: unknown) => { asked.push(checking); return { loans: true }; },
      preparePage: async (pageToPrepare: Page) => {
        libraryPage = pageToPrepare;
        await pageToPrepare.setRequestInterception(true);
        pageToPrepare.on("request", (request) => void (request.isNavigationRequest() ? request.respond({ status: 200, contentType: "text/html", body: "<p>page</p>" }) : request.abort()));
      },
    });
    scraper.onProgress((_company, payload) => { if (payload.type === "LOGGING_IN") setTimeout(() => void libraryPage?.goto(PORTAL), 300); });
    const result = await scraper.scrape({} as never);
    expect(result.success).toBe(false);
    expect(asked).toEqual([]);
  }, 60_000);
});
