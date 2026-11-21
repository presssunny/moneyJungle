// Stands in for israeli-bank-scrapers inside the sync worker. `credentials.mode` picks the behaviour,
// so one module covers what the worker sees, how it fails, and whether it can still launch Chrome.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fakeLoanAnswer, isFakeLoanScenario } from "./fakeLoanDetails";

type Listener = (company: unknown, payload: unknown) => void;

function procText(pid: number | "self", file: "environ" | "cmdline"): string {
  try { return readFileSync(`/proc/${pid}/${file}`, "utf8"); } catch { return ""; }
}

const loadedAppCode = () => Object.keys(require.cache).some((file) => /[\\/]src[\\/]config[\\/]|generated[\\/]prisma|@prisma[\\/]client/.test(file));

interface StubOptions {
  startDate: unknown;
  showBrowser?: boolean;
  args?: string[];
  prepareBrowser?: (browser: unknown) => Promise<unknown>;
  probe?: (line: string) => void;
  /** The worker's real IPC round-trip to the parent; absent when the flag is off or in a probe run. */
  decideFollowUp?: (checking: unknown) => Promise<{ loans: boolean; timedOut?: boolean }>;
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

export const STUB_LOAN = {
  loanNumber: "LN-1", trackNumber: "1", name: "הלוואה", asOf: "2026-10-31", originalAmount: 1200, principalBalance: 1000, indexedBalance: null,
  interestType: "prime", annualInterestRate: 6.5, primeMargin: 0.5, indexLinked: false, baseIndex: null, baseIndexMonth: null,
  paymentsMade: 10, paymentsTotal: 20, startDate: "2026-01-01", endDate: "2027-08-01",
  nextPaymentAmount: 105, nextPaymentDate: "2026-11-01",
  schedule: [{ paymentNumber: 11, date: "2026-11-01", principal: 100, interest: 5, linkage: null, total: 105, balanceAfter: 900 }],
};

export { STUB_LOAN_DIGITS } from "./fakeLoanDetails";

// A loan's two debits on one day, numbered: what the parent's detector reads as a loan payment day.
const LOAN_LINES = [["הלוואה - תשלום קרן 90001", -1000], ["הלוואה - תשלום ריבית 90001", -15]] as const;

/**
 * officialLogin's follow-up as the parent sees it, without a bank page: the decision goes over the
 * worker's real IPC; the move's verdict is `credentials.department`, the read is the fake's.
 */
async function loansFollowUp(options: StubOptions, checking: object, credentials: Record<string, string>, listener: Listener): Promise<unknown> {
  if (!options.decideFollowUp) return checking;
  // The parent's answer is lost: the worker hears no followUp command, so its own wait has to run out.
  if (credentials.mode === "loans-no-answer") process.removeAllListeners("message");
  // A checking result the parent's schema rejects: it must not reach the parent's decision.
  const decision = await options.decideFollowUp(credentials.checking === "malformed" ? { success: "yes" } : checking);
  if (credentials.mode === "loans-crash-after-checking") {
    if (credentials.after !== "close") process.exit(3);
    listener("stub", { type: "BROWSER_CLOSED" });
    return { success: false, errorType: "GENERIC", errorMessage: "Protocol error: Target closed" };
  }
  const department = credentials.department ?? "landed";
  const followUp = (details: string, name = department) => ({ department: name, details });
  if (decision.timedOut) return { ...checking, extras: { followUp: followUp("NOT_RUN", "NO_DECISION") } };
  if (!decision.loans) return { ...checking, extras: { followUp: followUp("NOT_RUN", "NOT_NEEDED") } };
  if (department !== "landed") return { ...checking, extras: { followUp: followUp("NOT_RUN") } };
  const scenario = isFakeLoanScenario(credentials.loans) ? credentials.loans : "not-approved";
  const answer = await fakeLoanAnswer(scenario).catch(() => null);
  if (!answer) return { ...checking, extras: { followUp: followUp("FAILED") } };
  return { ...checking, extras: { ...("loans" in answer ? { loans: answer.loans } : {}), followUp: followUp(answer.status) } };
}

export function createScraper(options: StubOptions) {
  let listener: Listener = () => {};
  return {
    onProgress(next: Listener) { listener = next; },
    async scrape(credentials: Record<string, string>): Promise<unknown> {
      const secret = credentials.password ?? "";
      // Like the library: Chrome is up (prepareBrowser) before the login page, so before LOGGING_IN.
      if (credentials.mode === "launch-fails") return { success: false, errorType: "GENERIC", errorMessage: "Failed to launch the browser process: Code: null" };
      await options.prepareBrowser?.({});
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
        case "tab-closed":
          // officialLogin when the library's own tab closes: the library terminates before any disconnect.
          listener("stub", { type: "TERMINATING" });
          return { success: false, errorType: "GENERIC", errorMessage: "BROWSER_TAB_CLOSED" };
        case "crash":
          process.exit(3);
          break;
        case "malformed":
          return { success: "yes" };
        case "probe-lines":
          // A worker gone wrong: two clean templates among raw URLs, account digits and a session id.
          for (const line of ["tab 1 page online.fibi.co.il/wps/myportal", "tab 1 page https://online.fibi.co.il/loans/58213?acct=12-345678", "tab 1 GET xhr online.fibi.co.il/api/loans/:id",
            "tab 1 page online.fibi.co.il/home;jsessionid=0000AbCd", "tab 1 page online.fibi.co.il/wps/myportal"]) options.probe?.(line);
          listener("stub", { type: "PROBE_SIGNED_IN" });
          return { success: false, errorType: "GENERIC", errorMessage: "PROBE_DONE" };
        case "probe-flood":
          for (let i = 0; i < 400; i++) options.probe?.(`tab 1 page online.fibi.co.il/${"x".repeat(1 + (i % 30))}/${"y".repeat(1 + Math.floor(i / 30))}`);
          process.stderr.write("late library error after the flood\n");
          // Its stderr reaches the parent before the result does.
          await new Promise((resolve) => setTimeout(resolve, 300));
          break;
      }
      listener("stub", { type: "LOGIN_SUCCESS" });
      const checking = { success: true, accounts: [{ accountNumber: "12-345", balance: null, txns: [{
        type: "normal", date: "2026-09-09T21:00:00.000Z", processedDate: "2026-10-01T21:00:00.000Z", originalAmount: -10,
        originalCurrency: "ILS", chargedAmount: -10, chargedCurrency: "ILS", description: "שופרסל", memo: null, status: "completed", identifier: 7,
      }] }] };
      if (credentials.mode === "extras") return { ...checking, extras: { loans: [{ ...STUB_LOAN, loanNumber: "0001" }] } };
      // A field the bank renamed, and a balance read as text.
      if (credentials.mode === "bad-extras") return { ...checking, extras: { loans: [{ ...STUB_LOAN, principalBalance: "1,000", yitra: 1 }] } };
      if (credentials.mode?.startsWith("loans-")) {
        const [first] = checking.accounts[0].txns;
        const txns = [first, ...LOAN_LINES.map(([description, amount]) => ({ ...first, description, originalAmount: amount, chargedAmount: amount }))];
        return loansFollowUp(options, { ...checking, accounts: [{ ...checking.accounts[0], txns }] }, credentials, listener);
      }
      return checking;
    },
  };
}
