import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import path from "node:path";
import puppeteer, { type Browser, type Page } from "puppeteer";
import { getCurrentUrl } from "israeli-bank-scrapers/lib/helpers/navigation";
import { TimeoutError } from "israeli-bank-scrapers/lib/helpers/waiting";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createScraper, OFFICIAL_LOGIN_URL, probePath, waitForSignIn } from "./officialLogin";
import { BROWSER_CLOSED } from "./scraperLaunch";

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
  it("keeps host and path only: no query, fragment, portal state or opaque token", () => {
    expect(probePath("https://online.fibi.co.il/MatafLoginService/MatafLoginServlet?bankId=FIBIPORTAL&site=Private#tok=abc")).toBe("online.fibi.co.il/MatafLoginService/MatafLoginServlet");
    expect(probePath("https://online.fibi.co.il/wps/myportal/FibiMenu/Online/!ut/p/z1/04_Sj9CPykssy0xPLMnMz0vMAfI")).toBe("online.fibi.co.il/wps/myportal/FibiMenu/Online/");
    expect(probePath(`https://online.fibi.co.il/session/${"a1".repeat(30)}/home`)).toBe("online.fibi.co.il/session/…/home");
    for (const other of ["about:blank", "data:text/html,<p>x</p>", "chrome-error://chromewebdata/", "not a url"]) expect(probePath(other)).toBeNull();
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

  it("reports a window she closed", async () => {
    const waiting = waitForSignIn(page, 15_000);
    setTimeout(() => void browser.close(), 500);
    await expect(waiting).rejects.toThrow(BROWSER_CLOSED);
  }, 30_000);
});

describe("officialLogin source (CLAUDE.md §7)", () => {
  it("only reads the bank's pages: no typing, clicking, focusing, injected scripts or cookie access", () => {
    const source = readFileSync(path.join(__dirname, "officialLogin.ts"), "utf8");
    const actions = /\.(click|type|focus|select|tap|hover|press|keyboard|mouse|touchscreen|evaluateOnNewDocument|addScriptTag|exposeFunction|setCookie|cookies|deleteCookie|uploadFile)\s*\(|\.(keyboard|mouse|touchscreen)\b/;
    expect(source).not.toMatch(actions);
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
});
