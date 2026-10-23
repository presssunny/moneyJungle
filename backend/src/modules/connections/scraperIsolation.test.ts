import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isolatedScraperFactory, redactLog, resultShape, sweepStaleRuns, workerEnv } from "./scraperIsolation";
import type { ScraperOptions } from "./scraperAdapter";

const STUB = path.resolve(__dirname, "../../testing/scraperStub.ts");
const options: ScraperOptions = { companyId: "beinleumi", startDate: new Date("2026-07-01T00:00:00.000Z"), defaultTimeout: 5_000, loginMethod: "password", loginWaitMs: 60_000 };
const SECRET = "pw-marker-6a1f";
const planted = { BANK_CREDENTIALS_KEY: "key-marker", DATABASE_URL: "mysql://db-marker", ANTHROPIC_API_KEY: "ai-marker", HTTPS_PROXY: "pac+http://proxy-marker", NODE_OPTIONS: "--inspect" };
const saved: Record<string, string | undefined> = {};

const RUN_ROOT = mkdtempSync(path.join(os.tmpdir(), "scraper-runs-"));
const runsLeft = () => readdirSync(RUN_ROOT).filter((name) => name.startsWith("run-"));

async function run(mode: string, factory = isolatedScraperFactory({ library: STUB, runRoot: RUN_ROOT })) {
  const scraper = await factory(options);
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
});

describe("resultShape", () => {
  it("logs which fields came back as counts — no amount, description or account number", () => {
    const txn = { type: "normal" as const, date: "2026-10-01", processedDate: "2026-10-01", originalAmount: -432.1, originalCurrency: "ILS", chargedAmount: -432.1, description: "שופרסל דיל", status: "completed" as const };
    const line = resultShape({ success: true, accounts: [{ accountNumber: "12-345-678901", balance: 9876.5, txns: [txn, { ...txn, status: "pending" as const, memo: "העברה", processedDate: "2026-10-03", originalCurrency: "USD" }] }] });
    expect(line).toBe("accounts=1 [txns=2 balance=yes pending=1 installments=0 memo=1 processedDiffers=1 foreign=1]");
    for (const secret of ["678901", "9876", "432", "שופרסל", "העברה"]) expect(line).not.toContain(secret);
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
