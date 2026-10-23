import puppeteer, { type Browser, type Page } from "puppeteer";
import { TimeoutError } from "israeli-bank-scrapers/lib/helpers/waiting";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createScraper, OFFICIAL_LOGIN_URL, probePath, waitForSignIn } from "./officialLogin";
import { BROWSER_CLOSED } from "./scraperLaunch";

// Offline: every request is answered here or aborted, so nothing reaches the bank.
const PORTAL = "https://online.fibi.co.il/Resources/PortalNG/shell";
const MARKETING_HOME = "https://www.fibi.co.il/wps/portal/FibiMenu/Marketing/Private/Home";
const LOGIN = "https://bank.test/login";

async function offline(page: Page) {
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    const known = [PORTAL, MARKETING_HOME, LOGIN].some((url) => request.url().startsWith(url));
    void (known ? request.respond({ status: 200, contentType: "text/html", body: "<p>page</p>" }) : request.abort());
  });
  return page;
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

describe("createScraper (official window)", () => {
  it("opens the bank's own page, fills and clicks nothing, and hands her signed-in session to the library's fetch", async () => {
    const requested: string[] = [];
    let libraryPage: Page | null = null;
    let started = 0;
    const scraper = createScraper({
      startDate: new Date("2026-09-01T00:00:00Z"), defaultTimeout: 2_000, showBrowser: false, loginWaitMs: 15_000,
      // The worker's signal that Chrome is up; officialLogin hooks the same callback and must pass it on.
      prepareBrowser: async () => { started += 1; },
      preparePage: async (pageToPrepare: Page) => {
        libraryPage = pageToPrepare;
        await pageToPrepare.setRequestInterception(true);
        pageToPrepare.on("request", (request) => {
          requested.push(request.url());
          void (request.isNavigationRequest() ? request.respond({ status: 200, contentType: "text/html", body: "<form><input id=username><input id=password type=password></form>" }) : request.abort());
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
