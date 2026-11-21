import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { STUB_LOAN, STUB_LOAN_DIGITS } from "../../testing/scraperStub";
import { STUB_LOAN_LAST4 } from "../../testing/fakeLoanDetails";
import type { ScrapedStandingOrder, ScrapeResult } from "../../types/connections.types";
import { isolatedScraperFactory, parseExtras, redactLog, resultShape, sweepStaleRuns, workerEnv } from "./scraperIsolation";
import type { ScraperOptions } from "./scraperAdapter";

const STUB = path.resolve(__dirname, "../../testing/scraperStub.ts");
// As the worker sends a loan read from a page: its number cut to the last 4 digits (§7 A2).
const LOAN_READ = { ...STUB_LOAN, loanNumber: "0001" };
const options: ScraperOptions = { companyId: "beinleumi", startDate: new Date("2026-07-01T00:00:00.000Z"), defaultTimeout: 5_000, loginMethod: "password", loginWaitMs: 60_000 };
const SECRET = "pw-marker-6a1f";
const planted = { BANK_CREDENTIALS_KEY: "key-marker", DATABASE_URL: "mysql://db-marker", ANTHROPIC_API_KEY: "ai-marker", HTTPS_PROXY: "pac+http://proxy-marker", NODE_OPTIONS: "--inspect" };
const saved: Record<string, string | undefined> = {};

const RUN_ROOT = mkdtempSync(path.join(os.tmpdir(), "scraper-runs-"));
const runsLeft = () => readdirSync(RUN_ROOT).filter((name) => name.startsWith("run-"));

async function run(mode: string, factory = isolatedScraperFactory({ library: STUB, runRoot: RUN_ROOT }), runOptions = options) {
  const scraper = await factory(runOptions);
  const progress: string[] = [];
  scraper.onProgress((type) => progress.push(type));
  const result = await scraper.scrape({ username: "u", password: SECRET, mode });
  return { result, progress };
}
const report = (message: string | undefined) => JSON.parse(message ?? "{}") as Record<string, unknown>;
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

beforeAll(() => {
  for (const [key, value] of Object.entries(planted)) { saved[key] = process.env[key]; process.env[key] = value; }
});
afterAll(() => {
  for (const [key, value] of Object.entries(saved)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  rmSync(RUN_ROOT, { recursive: true, force: true });
});

describe("workerEnv", () => {
  const display = { DISPLAY: ":0", WAYLAND_DISPLAY: "wayland-0", XDG_RUNTIME_DIR: "/run/user/1000" };
  it("passes only the allowlisted keys", () => {
    expect(workerEnv({ PATH: "/bin", HOME: "/home/x", TMPDIR: "/tmp", ...planted, ...display, HTTP_PROXY: "x", no_proxy: "y" })).toEqual({ PATH: "/bin", HOME: "/home/x" });
  });
  it("adds the desktop display only for a visible browser", () => {
    expect(workerEnv({ PATH: "/bin", ...planted, ...display }, { headed: true })).toEqual({ PATH: "/bin", ...display });
  });
});

describe("redactLog", () => {
  it("drops URLs and account-like digits from worker stderr", () => {
    expect(redactLog("at https://online.fibi.co.il/x?token=abc acct 12-345-678901 by a.b@c.co line 42")).toBe("at <url> acct <num> by <email> line 42");
  });
  it("drops her own credential values when a library error echoes them", () => {
    expect(redactLog("login rejected for dana-k with Pw!x9 (id 1)", ["dana-k", "Pw!x9", ""])).toBe("login rejected for <secret> with <secret> (id 1)");
  });
});

describe("resultShape", () => {
  it("logs which fields came back as counts — no amount, description or account number", () => {
    const txn = { type: "normal" as const, date: "2026-10-01", processedDate: "2026-10-01", originalAmount: -432.1, originalCurrency: "ILS", chargedAmount: -432.1, description: "שופרסל דיל", status: "completed" as const };
    const line = resultShape({ success: true, accounts: [{ accountNumber: "12-345-678901", balance: 9876.5, txns: [txn, { ...txn, status: "pending" as const, memo: "העברה", processedDate: "2026-10-03", originalCurrency: "USD" }] }] });
    expect(line).toBe("accounts=1 [txns=2 balance=yes pending=1 installments=0 memo=1 processedDiffers=1 foreign=1]");
    for (const secret of ["678901", "9876", "432", "שופרסל", "העברה"]) expect(line).not.toContain(secret);
  });
  it("counts the extras too — never a loan number, balance or rate", () => {
    const loan = { ...STUB_LOAN, interestType: "prime" as const, loanNumber: "LN-58213", principalBalance: 412345.67 };
    const line = resultShape({ success: true, accounts: [], extras: { loans: [loan, { ...loan, schedule: [] }], errors: [] } });
    expect(line).toBe("accounts=0 extras=[loans=2 schedules=1 payments=1 errors=none]");
    for (const secret of ["58213", "412345", "6.5", "הלוואה"]) expect(line).not.toContain(secret);
  });
});

describe("parseExtras", () => {
  it("is absent when the worker sent none", () => {
    expect(parseExtras(undefined)).toBeUndefined();
  });
  it("keeps unknown values as null, not 0", () => {
    const unknown = { ...LOAN_READ, principalBalance: null, annualInterestRate: null, primeMargin: null, paymentsMade: null, paymentsTotal: null, schedule: [{ ...LOAN_READ.schedule[0], interest: null, linkage: null }] };
    expect(parseExtras({ loans: [unknown] })).toEqual({ loans: [unknown], errors: [] });
  });
  it("rejects a renamed field or a number read as text instead of dropping it", () => {
    expect(parseExtras({ loans: [{ ...LOAN_READ, yitra: 1 }] })).toEqual({ errors: ["EXTRAS_INVALID"] });
    expect(parseExtras({ loans: [{ ...LOAN_READ, principalBalance: "1,000" }] })).toEqual({ errors: ["EXTRAS_INVALID"] });
    // A missing field is not an unknown one: unknown is an explicit null.
    const { indexedBalance: _dropped, ...missing } = LOAN_READ;
    expect(parseExtras({ loans: [missing] })).toEqual({ errors: ["EXTRAS_INVALID"] });
    expect(parseExtras({ loans: [{ ...LOAN_READ, schedule: [{ ...LOAN_READ.schedule[0], principal: Number.NaN }] }] })).toEqual({ errors: ["EXTRAS_INVALID"] });
  });
});

describe("sweepStaleRuns", () => {
  it("kills what a dead server's run left behind and deletes it, sparing other processes and live servers' runs", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "sweep-"));
    const deadServer = spawn("true");
    await new Promise((resolve) => deadServer.on("exit", resolve));
    const orphanDir = path.join(root, `run-${deadServer.pid}-old`);
    const liveDir = path.join(root, `run-${process.ppid}-busy`);
    mkdirSync(orphanDir);
    mkdirSync(liveDir);
    const leftover = spawn("sleep", ["300"], { cwd: orphanDir, detached: true, stdio: "ignore" });
    const stranger = spawn("sleep", ["300"], { detached: true, stdio: "ignore" });
    const liveRun = spawn("sleep", ["300"], { cwd: liveDir, detached: true, stdio: "ignore" });
    expect(sweepStaleRuns(root)).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(alive(leftover.pid!)).toBe(false);
    expect(alive(stranger.pid!)).toBe(true);
    expect(alive(liveRun.pid!)).toBe(true);
    expect(readdirSync(root)).toEqual([path.basename(liveDir)]);
    for (const pid of [stranger.pid!, liveRun.pid!]) process.kill(-pid, "SIGKILL");
    rmSync(root, { recursive: true, force: true });
  });
});

// Each case forks a ts-node worker; under a loaded full run its start-up alone can take seconds.
describe("isolated sync worker", { timeout: 60_000 }, () => {
  it("never sees the cipher key, the DB, proxies or app config, and gets credentials only over IPC", async () => {
    const { result } = await run("probe");
    const seen = report(result.errorMessage);
    for (const key of Object.keys(planted)) expect(seen.envKeys).not.toContain(key);
    expect(seen).toMatchObject({ secretInArgvOrEnv: false, appCodeLoaded: false, startDate: "2026-07-01T00:00:00.000Z" });
    expect(String(seen.cwd).startsWith(`${RUN_ROOT}${path.sep}run-`)).toBe(true);
    expect(path.dirname(String(seen.tmpdir))).toBe(os.tmpdir());
    expect(path.basename(String(seen.tmpdir))).toMatch(new RegExp(`^mj-sync-${process.pid}-`));
    expect(existsSync(String(seen.tmpdir))).toBe(false);
    expect(runsLeft()).toEqual([]);
  });

  it("relays progress and returns a validated result, tolerating the library's nulls", async () => {
    const { result, progress } = await run("ok");
    expect(progress).toEqual(["LOGGING_IN", "LOGIN_SUCCESS"]);
    expect(result.success).toBe(true);
    expect(result.accounts?.[0].txns[0]).toMatchObject({ description: "שופרסל", chargedAmount: -10 });
    expect(result.accounts?.[0].txns[0].memo).toBeUndefined();
    expect(result.accounts?.[0].txns[0]).not.toHaveProperty("identifier");
  });

  it("carries validated extras next to the checking rows", async () => {
    const { result } = await run("extras");
    expect(result).toMatchObject({ success: true, extras: { loans: [LOAN_READ], errors: [] } });
    expect(result.accounts?.[0].txns).toHaveLength(1);
  });

  it("keeps the checking rows when the extras are malformed, and says so", async () => {
    const [ok, bad] = [await run("ok"), await run("bad-extras")];
    expect(bad.result).toEqual({ ...ok.result, extras: { errors: ["EXTRAS_INVALID"] } });
    expect(ok.result).not.toHaveProperty("extras");
  });

  it("turns a malformed result into a failure instead of trusting it", async () => {
    expect((await run("malformed")).result).toMatchObject({ success: false, errorType: "GENERAL_ERROR" });
  });

  it("names a Chrome that never started — not the bank — and keeps the reason for the log", async () => {
    const { result, progress } = await run("launch-fails");
    expect(result).toMatchObject({ success: false, errorType: "BROWSER_LAUNCH", errorMessage: expect.stringContaining("Failed to launch") });
    expect(progress).toEqual([]);
    expect(runsLeft()).toEqual([]);
  });

  it("reports a worker that dies mid-scrape as a failure", async () => {
    expect((await run("crash")).result).toMatchObject({ success: false, errorType: "GENERAL_ERROR" });
  });

  it("kills the worker and everything it spawned once the hard limit passes", async () => {
    const { result, progress } = await run("hang", isolatedScraperFactory({ library: STUB, hardLimitMs: 10_000, runRoot: RUN_ROOT }));
    expect(result).toMatchObject({ success: false, errorType: "TIMEOUT" });
    const grandchild = Number(progress.find((p) => p.startsWith("pid:"))?.slice(4));
    expect(grandchild).toBeGreaterThan(0);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(alive(grandchild)).toBe(false);
  });

  it("kills a detached process it was never told about — Chrome stopped while still starting", async () => {
    const { result, progress } = await run("detached-hang", isolatedScraperFactory({ library: STUB, hardLimitMs: 10_000, runRoot: RUN_ROOT }));
    expect(result).toMatchObject({ success: false, errorType: "TIMEOUT" });
    const browserLike = Number(progress.find((p) => p.startsWith("pid:"))?.slice(4));
    expect(browserLike).toBeGreaterThan(0);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(alive(browserLike)).toBe(false);
    expect(runsLeft()).toEqual([]);
  });

  it("closes the Chrome it launched — its own process group — and deletes the profile once the hard limit passes", async () => {
    const { result, progress } = await run("chrome-hang", isolatedScraperFactory({ library: STUB, hardLimitMs: 20_000, runRoot: RUN_ROOT }));
    expect(result).toMatchObject({ success: false, errorType: "TIMEOUT" });
    const chrome = Number(progress.find((p) => p.startsWith("chrome:"))?.slice(7));
    expect(chrome).toBeGreaterThan(0);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(alive(chrome)).toBe(false);
    expect(runsLeft()).toEqual([]);
  }, 60_000);

  it("takes Chrome down when the API server itself is killed mid-sync", async () => {
    const env = { ...process.env };
    delete env.NODE_OPTIONS;
    const parent = spawn(process.execPath, ["-r", require.resolve("ts-node/register/transpile-only"), path.resolve(__dirname, "../../testing/isolationParent.ts"), RUN_ROOT], { env, stdio: ["ignore", "pipe", "inherit"] });
    const chrome = await new Promise<number>((resolve, reject) => {
      parent.stdout.on("data", (chunk: Buffer) => { const match = /chrome:(\d+)/.exec(chunk.toString()); if (match) resolve(Number(match[1])); });
      parent.on("exit", () => reject(new Error("parent exited before Chrome started")));
    });
    expect(alive(chrome)).toBe(true);
    parent.kill("SIGKILL");
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    expect(alive(chrome)).toBe(false);
    // The dead server could not delete its run directory; the next boot's sweep does.
    expect(runsLeft()).toHaveLength(1);
    expect(sweepStaleRuns(RUN_ROOT)).toBe(1);
    expect(runsLeft()).toEqual([]);
  }, 60_000);

  it("runs an official-window login through its own module, with the desktop display and nothing else added", async () => {
    const display = { DISPLAY: ":99", WAYLAND_DISPLAY: "wayland-test", XDG_RUNTIME_DIR: "/run/user/test" };
    const saved = Object.fromEntries(Object.keys(display).map((key) => [key, process.env[key]]));
    Object.assign(process.env, display);
    try {
      const factory = isolatedScraperFactory({ library: "no-such-scraper-lib", officialLibrary: STUB, runRoot: RUN_ROOT });
      const scraper = await factory({ ...options, loginMethod: "official_window" });
      const seen = report((await scraper.scrape({ mode: "probe" })).errorMessage);
      expect(seen.envKeys).toEqual(expect.arrayContaining(Object.keys(display)));
      for (const key of Object.keys(planted)) expect(seen.envKeys).not.toContain(key);
    } finally {
      for (const [key, value] of Object.entries(saved)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    const password = report((await run("probe")).result.errorMessage);
    expect(password.envKeys).not.toContain("DISPLAY");
  });

  it("names a window she closed mid-fetch, not a generic failure", async () => {
    expect((await run("closed-during-fetch")).result).toMatchObject({ success: false, errorType: "BROWSER_CLOSED" });
  });

  it("tells a closed bank tab apart from a closed window", async () => {
    expect((await run("tab-closed")).result).toMatchObject({ success: false, errorType: "BROWSER_TAB_CLOSED" });
    expect(runsLeft()).toEqual([]);
  });

  it("cancels on request: CANCELLED, worker gone, run directory removed", async () => {
    const scraper = await isolatedScraperFactory({ library: STUB, runRoot: RUN_ROOT })(options);
    const progress: string[] = [];
    scraper.onProgress((type) => progress.push(type));
    const pending = scraper.scrape({ mode: "detached-hang" });
    await expect.poll(() => progress.some((p) => p.startsWith("pid:"))).toBe(true);
    scraper.cancel();
    expect(await pending).toMatchObject({ success: false, errorType: "CANCELLED" });
    const browserLike = Number(progress.find((p) => p.startsWith("pid:"))?.slice(4));
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(alive(browserLike)).toBe(false);
    expect(runsLeft()).toEqual([]);
  });

  it("explains a missing scraper library in Hebrew", async () => {
    await expect(isolatedScraperFactory({ library: "no-such-scraper-lib", runRoot: RUN_ROOT })(options)).rejects.toThrow(/לא מותקן/);
    expect(runsLeft()).toEqual([]);
  });

  it("launches Chrome with the sandbox on and without the server's secrets", async () => {
    const seen = report((await run("chrome")).result.errorMessage);
    expect(seen).toMatchObject({ text: "ok", noSandbox: false, secretInChrome: false });
    expect(String(seen.profile).startsWith(`${RUN_ROOT}${path.sep}run-`)).toBe(true);
    for (const key of Object.keys(planted)) expect(seen.chromeEnvKeys).not.toContain(key);
  }, 60_000);

  // Chrome binds $TMPDIR/.org.chromium.Chromium.XXXXXX/SingletonSocket, and a socket path is capped
  // at 107 bytes, which a TMPDIR under a run root as deep as the real one (~/.local/state/…) exceeds.
  it("launches Chrome from a run root as deep as the real one", async () => {
    const deepRoot = path.join(RUN_ROOT, "as-deep-as-home-local-state-runs-xx");
    expect(deepRoot.length).toBeGreaterThanOrEqual(path.join(os.homedir(), ".local/state/moneyjungle/scraper-runs").length);
    const { result } = await run("chrome", isolatedScraperFactory({ library: STUB, runRoot: deepRoot }));
    expect(result.errorType, result.errorMessage).toBe("PROBE");
    expect(report(result.errorMessage)).toMatchObject({ text: "ok" });
  }, 60_000);

  it("loads the real library and builds a scraper without logging in", async () => {
    // No scrape call: cancel reaps the worker and deletes its directories.
    const scraper = await isolatedScraperFactory({ hardLimitMs: 30_000, runRoot: RUN_ROOT })(options);
    expect(typeof scraper.scrape).toBe("function");
    scraper.cancel();
    expect(runsLeft()).toEqual([]);
  }, 60_000);
});

describe("a probe run (CONNECTION_URL_PROBE)", () => {
  const PROBE_ROOT = path.join(RUN_ROOT, "probes");
  const probing = () => isolatedScraperFactory({ library: STUB, officialLibrary: STUB, runRoot: RUN_ROOT, urlProbe: true, probeRoot: PROBE_ROOT });
  const official = { ...options, loginMethod: "official_window" as const };
  async function logged(mode: string) {
    const lines: string[] = [];
    const spies = (["log", "info", "warn", "error"] as const).map((level) => vi.spyOn(console, level).mockImplementation((...args: unknown[]) => { lines.push(args.map(String).join(" ")); }));
    try {
      const { result } = await run(mode, probing(), official);
      return { result, console: lines.join("\n") };
    } finally {
      spies.forEach((spy) => spy.mockRestore());
    }
  }
  const fileIn = (text: string) => /נכתבו ל־(\S+\.log)/.exec(text)?.[1] ?? "";

  it("refuses a password login before any browser opens: only the official window stops after sign-in", async () => {
    await expect(probing()(options)).rejects.toThrow(/רק בכניסה בחלון הרשמי/);
    expect(runsLeft()).toEqual([]);
  });

  it("refuses to move the bank's app outside a probe run, before any browser opens", async () => {
    await expect(isolatedScraperFactory({ library: STUB, officialLibrary: STUB, runRoot: RUN_ROOT, siteDiscovery: true })(official)).rejects.toThrow(/רק בהקלטת מבנה האתר/);
    expect(runsLeft()).toEqual([]);
  });

  it("imports nothing, even if the window's module came back with her account", async () => {
    const { result } = await logged("checking");
    expect(result).toMatchObject({ success: false, errorType: "PROBE_DONE" });
    expect(result.accounts).toBeUndefined();
    expect(runsLeft()).toEqual([]);
  });

  it("writes only clean templates, to its own file and never to the server log", async () => {
    const { result, console: text } = await logged("probe-lines");
    expect(result).toMatchObject({ success: false, errorType: "PROBE_DONE" });
    expect(text).toContain("probe: 2 שורות נכתבו ל־");
    expect(text).toContain("2 נדחו");
    for (const leaked of ["myportal", "api/loans", "58213", "12-345678", "jsessionid"]) expect(text, leaked).not.toContain(leaked);
    const file = readFileSync(fileIn(text), "utf8");
    expect(file.trim().split("\n").map((line) => line.replace(/^\[\+\d+s\] /, ""))).toEqual([
      "tab 1 page online.fibi.co.il/wps/myportal", "tab 1 GET xhr online.fibi.co.il/api/loans/:id", "end written=2 dropped=0 rejected=2",
    ]);
    expect(runsLeft()).toEqual([]);
  });

  it("marks a flood it cut off, and a later library error still reaches the server log", async () => {
    const { console: text } = await logged("probe-flood");
    expect(text).toContain("probe: 300 שורות נכתבו ל־");
    expect(text).toContain("100 נשמטו מעבר לתקרה");
    expect(text).toContain("late library error after the flood");
    expect(readFileSync(fileIn(text), "utf8")).toContain("end written=300 dropped=100 rejected=0");
  });
});

// The real worker and IPC round-trip, the stub standing in for officialLogin's follow-up (scraperStub.ts loans-*).
describe("the loan follow-up after the checking fetch (CONNECTION_LOANS_DEPARTMENT)", { timeout: 60_000 }, () => {
  const official = { ...options, loginMethod: "official_window" as const };
  const loansOn = () => isolatedScraperFactory({ library: STUB, officialLibrary: STUB, runRoot: RUN_ROOT, loansDepartment: true });
  type Decide = NonNullable<ScraperOptions["decideFollowUp"]>;
  async function followUp(credentials: Record<string, string>, decide: Decide | undefined, factory = loansOn(), runOptions: ScraperOptions = official) {
    const asked: ScrapeResult[] = [];
    const scraper = await factory({ ...runOptions, ...(decide && { decideFollowUp: (checking: ScrapeResult) => { asked.push(checking); return decide(checking); } }) });
    const started = Date.now();
    const result = await scraper.scrape({ mode: "loans-followup", ...credentials });
    return { result, asked, seconds: (Date.now() - started) / 1000, scraper };
  }
  const yes: Decide = async () => ({ loans: true, standingOrders: false });
  const no: Decide = async () => ({ loans: false, standingOrders: false });

  it("asks the parent once with the validated checking rows; no loans means no move and no read", async () => {
    const { result, asked } = await followUp({}, no);
    expect(asked).toHaveLength(1);
    expect(asked[0].accounts?.[0].txns.map((t) => t.description)).toEqual(["שופרסל", "הלוואה - תשלום קרן 90001", "הלוואה - תשלום ריבית 90001"]);
    expect(asked[0].accounts?.[0].txns[0]).not.toHaveProperty("identifier");
    expect(result).toMatchObject({ success: true, extras: { errors: [], followUp: { department: "NOT_NEEDED", details: "NOT_RUN" } } });
    expect(result.extras).not.toHaveProperty("loans");
  });

  it("leaves the checking rows exactly as with the flag off, whatever the follow-up did", async () => {
    const off = await followUp({}, yes, isolatedScraperFactory({ library: STUB, officialLibrary: STUB, runRoot: RUN_ROOT }));
    expect(off.asked).toEqual([]);
    expect(off.result).not.toHaveProperty("extras");
    for (const credentials of [{}, { loans: "one" }, { loans: "malformed" }, { department: "SESSION_LOST" }] as Array<Record<string, string>>) {
      const on = await followUp(credentials, yes);
      expect({ ...on.result, extras: undefined }).toEqual({ ...off.result, extras: undefined });
    }
  });

  it("carries a fake read's loans, validated, with where the follow-up got", async () => {
    const { result } = await followUp({ loans: "last4" }, yes);
    expect(result.extras).toEqual({ loans: [STUB_LOAN_LAST4], errors: [], followUp: { department: "landed", details: "READ" } });
    expect(resultShape(result)).toMatch(/extras=\[loans=1 schedules=0 payments=0 errors=none followUp=landed\/READ\]$/);
  });

  // §7 A2: the worker cuts a loan number to its last 4 digits; a full one reaching the parent is a leak, dropped whole.
  it("drops a read whose loan number came through in full", async () => {
    const { result } = await followUp({ loans: "one" }, yes);
    expect(result.extras).toEqual({ errors: ["EXTRAS_INVALID"], followUp: { department: "landed", details: "READ" } });
    expect(JSON.stringify(result.extras)).not.toContain("90001");
  });

  it("is asked with CONNECTION_DEPARTMENT_READ alone, and never by a probe run", async () => {
    const readOnly = () => isolatedScraperFactory({ library: STUB, officialLibrary: STUB, runRoot: RUN_ROOT, departmentRead: ["standing_orders"] });
    const on = await followUp({}, no, readOnly());
    expect(on.asked).toHaveLength(1);
    expect(on.result.extras?.followUp).toEqual({ department: "NOT_NEEDED", details: "NOT_RUN" });
    const none = await followUp({}, yes, isolatedScraperFactory({ library: STUB, officialLibrary: STUB, runRoot: RUN_ROOT, departmentRead: [] }));
    expect(none.asked).toEqual([]);
  });

  it("reports the shipped details step as not approved, with no loans", async () => {
    expect((await followUp({}, yes)).result.extras).toEqual({ errors: [], followUp: { department: "landed", details: "NOT_APPROVED" } });
  });

  it("reports a details page that was not there", async () => {
    expect((await followUp({ loans: "unavailable" }, yes)).result.extras).toEqual({ errors: [], followUp: { department: "landed", details: "UNAVAILABLE" } });
  });

  it("drops a malformed read as EXTRAS_INVALID and keeps the follow-up's codes", async () => {
    const { result } = await followUp({ loans: "malformed" }, yes);
    expect(result.extras).toEqual({ errors: ["EXTRAS_INVALID"], followUp: { department: "landed", details: "READ" } });
    expect(result.accounts?.[0].txns).toHaveLength(3);
  });

  it("names a stop on the way to the loans page and reads nothing", async () => {
    expect((await followUp({ department: "SESSION_LOST", loans: "one" }, yes)).result.extras).toEqual({ errors: [], followUp: { department: "SESSION_LOST", details: "NOT_RUN" } });
  });

  it("keeps the checking rows read before the worker crashed in the follow-up", async () => {
    const { result } = await followUp({ mode: "loans-crash-after-checking" }, yes);
    expect(result).toMatchObject({ success: true, extras: { errors: [], followUp: { department: "ERROR", details: "NOT_RUN" } } });
    expect(result.accounts?.[0].txns).toHaveLength(3);
    expect(runsLeft()).toEqual([]);
  });

  it("keeps the checking rows read before she closed the window in the follow-up", async () => {
    const { result } = await followUp({ mode: "loans-crash-after-checking", after: "close" }, yes);
    expect(result).toMatchObject({ success: true, extras: { followUp: { department: "CLOSED", details: "NOT_RUN" } } });
    expect(result.accounts?.[0].txns).toHaveLength(3);
  });

  it("lets her cancel during the follow-up: CANCELLED, and the checking rows already read are not offered", async () => {
    const asked: ScrapeResult[] = [];
    const scraper = await loansOn()({ ...official, decideFollowUp: (checking) => { asked.push(checking); return new Promise(() => {}); } });
    const pending = scraper.scrape({ mode: "loans-followup" });
    await expect.poll(() => asked.length).toBe(1);
    scraper.cancel();
    const result = await pending;
    expect(result).toMatchObject({ success: false, errorType: "CANCELLED" });
    expect(result.accounts).toBeUndefined();
    expect(runsLeft()).toEqual([]);
  });

  it("answers 'no move' itself when the decision hangs, inside the worker's own wait", async () => {
    const { result, seconds } = await followUp({ loans: "one" }, () => new Promise(() => {}));
    expect(result.extras).toEqual({ errors: [], followUp: { department: "NOT_NEEDED", details: "NOT_RUN" } });
    expect(seconds).toBeGreaterThanOrEqual(8);
    expect(seconds).toBeLessThan(20);
  });

  it("answers 'no move' when the decision throws", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect((await followUp({ loans: "one" }, async () => { throw new Error("db down"); })).result.extras?.followUp).toEqual({ department: "NOT_NEEDED", details: "NOT_RUN" });
    } finally {
      warn.mockRestore();
    }
  });

  it("goes on without the move when no answer reaches the worker in time", async () => {
    const { result, asked, seconds } = await followUp({ mode: "loans-no-answer", loans: "one" }, yes);
    expect(asked).toHaveLength(1);
    expect(result).toMatchObject({ success: true, extras: { errors: [], followUp: { department: "NO_DECISION", details: "NOT_RUN" } } });
    expect(result.accounts?.[0].txns).toHaveLength(3);
    expect(seconds).toBeGreaterThanOrEqual(9);
  });

  it("never asks with a checking result that fails validation", async () => {
    const { result, asked } = await followUp({ checking: "malformed", loans: "one" }, yes);
    expect(asked).toEqual([]);
    expect(result.extras?.followUp).toEqual({ department: "NOT_NEEDED", details: "NOT_RUN" });
  });

  it("runs only for the official window: a password login with the flag on is never asked", async () => {
    const { result, asked } = await followUp({}, yes, loansOn(), options);
    expect(asked).toEqual([]);
    expect(result).not.toHaveProperty("extras");
  });
});

describe("parseExtras: the follow-up's report", () => {
  it("keeps the codes of a follow-up whose loans were malformed, and rejects a code it does not know", () => {
    expect(parseExtras({ loans: [{ ...STUB_LOAN_DIGITS, yitra: 1 }], followUp: { department: "landed", details: "READ" } })).toEqual({ followUp: { department: "landed", details: "READ" }, errors: ["EXTRAS_INVALID"] });
    expect(parseExtras({ followUp: { department: "SESSION_LOST", details: "NOT_RUN" } })).toEqual({ followUp: { department: "SESSION_LOST", details: "NOT_RUN" }, errors: [] });
    expect(parseExtras({ followUp: { department: "https://online.fibi.co.il/x", details: "NOT_RUN" } })).toEqual({ errors: ["EXTRAS_INVALID"] });
    expect(parseExtras({ followUp: { department: "landed", details: "READ", value: 412345 } })).toEqual({ errors: ["EXTRAS_INVALID"] });
  });

  it("carries the rows a read could not place as a bounded count, never anything else", () => {
    const followUp = { department: "landed", details: "READ", rejected: 3, standingOrders: { department: "landed", details: "READ", rejected: 0 } };
    expect(parseExtras({ followUp })).toEqual({ followUp, errors: [] });
    for (const rejected of [-1, 1.5, 501, "3", ["row"]]) expect(parseExtras({ followUp: { ...followUp, rejected } }), JSON.stringify(rejected)).toEqual({ errors: ["EXTRAS_INVALID"] });
    expect(resultShape({ success: true, accounts: [], extras: { errors: [], followUp: { department: "landed", details: "READ", rejected: 3, standingOrders: { department: "landed", details: "READ", rejected: 2 } } } }))
      .toBe("accounts=0 extras=[loans=0 schedules=0 payments=0 errors=none followUp=landed/READ rejected=3 standingOrders=landed/READ rejected=2]");
  });

  it("keeps the standing-orders department's own codes, with the same enums", () => {
    const followUp = { department: "landed", details: "READ", standingOrders: { department: "SESSION_LOST", details: "NOT_RUN" } };
    expect(parseExtras({ followUp })).toEqual({ followUp, errors: [] });
    expect(parseExtras({ followUp: { ...followUp, standingOrders: { department: "landed", details: "DOWNLOADED" } } })).toEqual({ errors: ["EXTRAS_INVALID"] });
    expect(parseExtras({ followUp: { ...followUp, standingOrders: { department: "landed", details: "READ", rows: 3 } } })).toEqual({ errors: ["EXTRAS_INVALID"] });
  });
});

describe("parseExtras: the table read's fields (§7 A2)", () => {
  const order: ScrapedStandingOrder = { payee: "חברת החשמל", amount: 250.5, dayOfMonth: 10, kind: "standing_order", status: "active", reference: "4321", lastChargeDate: "2026-10-10" };
  const loan = { ...STUB_LOAN_LAST4, trackNumber: "0301" };

  it("accepts standing orders and snapshot loans in their fixed shape, unknowns as null", () => {
    const unknown = { payee: "ביטוח", amount: null, dayOfMonth: null, kind: null, status: null, reference: null, lastChargeDate: null };
    expect(parseExtras({ loans: [loan], standingOrders: [order, unknown], errors: [] })).toEqual({ loans: [loan], standingOrders: [order, unknown], errors: [] });
  });

  it("rejects an extra key, a wrong enum or a value read as text", () => {
    for (const bad of [{ ...order, iban: "x" }, { ...order, kind: "transfer" }, { ...order, status: "paused" }, { ...order, amount: "250" }, { ...order, dayOfMonth: 32 },
      { ...order, dayOfMonth: 0 }, { ...order, lastChargeDate: "10/10/2026" }, { ...order, payee: "" }, { ...order, payee: "x".repeat(61) }]) {
      expect(parseExtras({ standingOrders: [bad] }), JSON.stringify(bad)).toEqual({ errors: ["EXTRAS_INVALID"] });
    }
    const { lastChargeDate: _dropped, ...missing } = order;
    expect(parseExtras({ standingOrders: [missing] })).toEqual({ errors: ["EXTRAS_INVALID"] });
  });

  it("rejects any number longer than its last 4 digits: loan, track, reference, or one left in a name", () => {
    for (const bad of [{ standingOrders: [{ ...order, reference: "54321" }] }, { standingOrders: [{ ...order, reference: "12-3" }] }, { standingOrders: [{ ...order, payee: "ביטוח לאומי 123456789" }] },
      { loans: [{ ...loan, loanNumber: "12345" }] }, { loans: [{ ...loan, loanNumber: "LN-58213" }] }, { loans: [{ ...loan, trackNumber: "000301" }] }, { loans: [{ ...loan, name: "הלוואה 12-345678" }] },
      // QA 2026-11-16: digits split by separators are still one number, and an identifier is digits only.
      { loans: [{ ...loan, loanNumber: "1234-5678" }] }, { loans: [{ ...loan, loanNumber: "12 345 678" }] }, { loans: [{ ...loan, loanNumber: "LN-1" }] },
      { loans: [{ ...loan, trackNumber: "99-88-77-66" }] }, { loans: [{ ...loan, name: "הלוואה 12-345-678" }] }, { loans: [{ ...loan, name: "הלוואה 12-3456" }] },
      { standingOrders: [{ ...order, payee: "חשמל 12-345-6789" }] }, { standingOrders: [{ ...order, payee: "ועד 1 234 5" }] }]) {
      expect(parseExtras(bad), JSON.stringify(bad)).toEqual({ errors: ["EXTRAS_INVALID"] });
    }
    expect(parseExtras({ loans: [{ ...loan, name: "הלוואה 2026 מס' 12" }] })).toEqual({ loans: [{ ...loan, name: "הלוואה 2026 מס' 12" }], errors: [] });
  });

  it("rejects an oversized list rather than trimming it", () => {
    expect(parseExtras({ standingOrders: Array.from({ length: 100 }, () => order) })?.standingOrders).toHaveLength(100);
    expect(parseExtras({ standingOrders: Array.from({ length: 101 }, () => order) })).toEqual({ errors: ["EXTRAS_INVALID"] });
    expect(parseExtras({ loans: Array.from({ length: 51 }, () => loan) })).toEqual({ errors: ["EXTRAS_INVALID"] });
  });

  it("counts standing orders in the log line, never a payee, amount or reference", () => {
    const line = resultShape({ success: true, accounts: [], extras: { standingOrders: [order], errors: [], followUp: { department: "landed", details: "READ", standingOrders: { department: "landed", details: "READ" } } } });
    expect(line).toBe("accounts=0 extras=[loans=0 orders=1 schedules=0 payments=0 errors=none followUp=landed/READ standingOrders=landed/READ]");
    for (const secret of ["חשמל", "250", "4321", "2026"]) expect(line).not.toContain(secret);
  });
});
