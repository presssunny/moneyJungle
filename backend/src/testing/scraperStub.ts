// Stands in for israeli-bank-scrapers inside the sync worker. `credentials.mode` picks the behaviour,
// so one module covers what the worker sees, how it fails, and whether it can still launch Chrome.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

type Listener = (company: unknown, payload: unknown) => void;

function procText(pid: number | "self", file: "environ" | "cmdline"): string {
  try { return readFileSync(`/proc/${pid}/${file}`, "utf8"); } catch { return ""; }
}

const loadedAppCode = () => Object.keys(require.cache).some((file) => /[\\/]src[\\/]config[\\/]|generated[\\/]prisma|@prisma[\\/]client/.test(file));

interface StubOptions {
  startDate: unknown;
  showBrowser?: boolean;
  args?: string[];
}

// The same launch the library performs (base-scraper-with-browser.js), with the worker's args.
async function launchLikeLibrary(options: StubOptions) {
  const puppeteer = (await import("puppeteer")).default;
  const browser = await puppeteer.launch({ headless: !options.showBrowser, args: options.args });
  return browser;
}

async function chromeReport(options: StubOptions, secret: string) {
  const browser = await launchLikeLibrary(options);
  const page = await browser.newPage();
  await page.setContent("<p id=x>ok</p>");
  const text = await page.$eval("#x", (el) => el.textContent);
  const pid = browser.process()?.pid ?? 0;
  const environ = procText(pid, "environ");
  const cmdline = procText(pid, "cmdline");
  await browser.close();
  const profile = cmdline.split("\0").find((arg) => arg.startsWith("--user-data-dir="))?.slice("--user-data-dir=".length) ?? "";
  return { text, chromeEnvKeys: environ.split("\0").filter(Boolean).map((kv) => kv.split("=")[0]).sort(), noSandbox: cmdline.includes("--no-sandbox"), secretInChrome: environ.includes(secret) || cmdline.includes(secret), profile };
}

export function createScraper(options: StubOptions) {
  let listener: Listener = () => {};
  return {
    onProgress(next: Listener) { listener = next; },
    async scrape(credentials: Record<string, string>): Promise<unknown> {
      const secret = credentials.password ?? "";
      listener("stub", { type: "LOGGING_IN" });
      switch (credentials.mode) {
        case "probe":
          return { success: false, errorType: "PROBE", errorMessage: JSON.stringify({
            envKeys: Object.keys(process.env).sort(),
            cwd: process.cwd(),
            tmpdir: process.env.TMPDIR ?? "",
            secretInArgvOrEnv: procText("self", "cmdline").includes(secret) || procText("self", "environ").includes(secret),
            appCodeLoaded: loadedAppCode(),
            startDate: options.startDate instanceof Date ? options.startDate.toISOString() : "not-a-date",
          }) };
        case "chrome":
          return { success: false, errorType: "PROBE", errorMessage: JSON.stringify(await chromeReport(options, secret)) };
        case "chrome-hang": {
          const browser = await launchLikeLibrary(options);
          listener("stub", { type: `chrome:${browser.process()?.pid ?? 0}` });
          return new Promise(() => {});
        }
        case "hang": {
          const grandchild = spawn("sleep", ["300"], { stdio: "ignore" });
          listener("stub", { type: `pid:${grandchild.pid}` });
          return new Promise(() => {});
        }
        case "detached-hang": {
          // Like Chrome mid-launch: its own process group, pid never reported to the parent.
          const browserLike = spawn("sleep", ["300"], { detached: true, stdio: "ignore" });
          listener("stub", { type: `pid:${browserLike.pid}` });
          return new Promise(() => {});
        }
        case "closed-during-fetch":
          // What officialLogin reports when she closes the window after login, then puppeteer's own error.
          listener("stub", { type: "LOGIN_SUCCESS" });
          listener("stub", { type: "BROWSER_CLOSED" });
          return { success: false, errorType: "GENERIC", errorMessage: "Protocol error: Target closed" };
        case "crash":
          process.exit(3);
          break;
        case "malformed":
          return { success: "yes" };
      }
      listener("stub", { type: "LOGIN_SUCCESS" });
      return { success: true, accounts: [{ accountNumber: "12-345", balance: null, txns: [{
        type: "normal", date: "2026-09-09T21:00:00.000Z", processedDate: "2026-10-01T21:00:00.000Z", originalAmount: -10,
        originalCurrency: "ILS", chargedAmount: -10, chargedCurrency: "ILS", description: "שופרסל", memo: null, status: "completed", identifier: 7,
      }] }] };
    },
  };
}
