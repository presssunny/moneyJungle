import { fork } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { ApiError } from "../../utils/ApiError";
import type { ScrapeResult, WorkerCommand, WorkerEvent } from "../../types/connections.types";
import type { ScraperFactory, ScraperRun } from "./scraperAdapter";
import { killProcessesIn, processAlive } from "./runProcesses";
import { BROWSER_CLOSED, BROWSER_LAUNCH, BROWSER_STARTED, BROWSER_TAB_CLOSED } from "./scraperLaunch";

const LIBRARY = "israeli-bank-scrapers";
const HARD_LIMIT_MS = 15 * 60_000;
// On ext4, not the 777 /mnt/c mount: a run directory holds a live bank profile until it is removed.
const RUN_ROOT = path.join(os.homedir(), ".local/state/moneyjungle/scraper-runs");
const STDERR_CAP = 4_000;
// Chrome binds $TMPDIR/.org.chromium.Chromium.XXXXXX/SingletonSocket, and a Unix socket path is
// capped at 107 bytes: under RUN_ROOT it came to 117 and Chrome died before its window opened.
// So Chrome's TMPDIR is a short private directory of its own, deleted with the run.
const TMP_PREFIX = "mj-sync-";
const CHROME_SOCKET = "/.org.chromium.Chromium.XXXXXX/SingletonSocket";
const MAX_SOCKET_PATH = 107;

// An allowlist, not a denylist: DATABASE_URL, BANK_CREDENTIALS_KEY, API keys, NODE_OPTIONS and
// every *_PROXY stay behind. The library hands Chrome its own env, so this is also Chrome's env.
const WORKER_ENV_KEYS = ["PATH", "HOME", "TZ", "LANG", "LC_ALL", "PUPPETEER_CACHE_DIR", "PUPPETEER_EXECUTABLE_PATH"] as const;
const DISPLAY_ENV_KEYS = ["DISPLAY", "WAYLAND_DISPLAY", "XDG_RUNTIME_DIR"] as const;

export function workerEnv(source: NodeJS.ProcessEnv, { headed = false } = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of [...WORKER_ENV_KEYS, ...(headed ? DISPLAY_ENV_KEYS : [])]) {
    const value = source[key];
    if (value) env[key] = value;
  }
  return env;
}

/** Worker stderr can carry bank URLs (with query tokens), emails or account digits from a stack trace. */
export function redactLog(text: string): string {
  return text.replace(/https?:\/\/\S+/g, "<url>").replace(/\S+@\S+/g, "<email>").replace(/\d[\d-]{2,}\d/g, "<num>").slice(0, STDERR_CAP);
}

function removeRun(...dirs: string[]) {
  for (const dir of dirs) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    } catch (error) {
      console.warn("[סנכרון] לא הצלחנו למחוק תיקיית ריצה של הדפדפן", error instanceof Error ? error.message : error);
    }
  }
}

/** A directory named for a server (`<prefix><pid>-…`) that is gone, or for this one: no live run owns it. */
function staleIn(root: string, prefix: string): string[] {
  let entries: string[];
  try { entries = readdirSync(root); } catch { return []; }
  return entries.filter((name) => {
    if (!name.startsWith(prefix)) return false;
    const owner = Number(name.slice(prefix.length).split("-")[0]);
    return !(owner && owner !== process.pid && processAlive(owner));
  }).map((name) => path.join(root, name));
}

/**
 * Boot-time cleanup for a server that died mid-sync: kills whatever still runs inside its old
 * run directories, then deletes them with their profiles. A run whose server (named in the
 * directory) is alive belongs to another instance — a test run or a second dev server — and stays.
 */
export function sweepStaleRuns(root = RUN_ROOT, tmpRoot = os.tmpdir()): number {
  const runs = staleIn(root, "run-");
  for (const runDir of runs) killProcessesIn(runDir);
  removeRun(...runs, ...staleIn(tmpRoot, TMP_PREFIX));
  return runs.length;
}

// Same extension as this file: the compiled .js in a build, the .ts under ts-node-dev and vitest.
const OFFICIAL_LOGIN = path.join(__dirname, `officialLogin${path.extname(__filename)}`);

/** Built code forks the compiled worker; source (ts-node-dev, vitest) forks the .ts through ts-node. */
function workerEntry(): { file: string; execArgv: string[]; env: Record<string, string> } {
  const ext = path.extname(__filename);
  const file = path.join(__dirname, `scraperWorker${ext}`);
  const execArgv = ["--max-old-space-size=512"];
  if (ext !== ".ts") return { file, execArgv, env: {} };
  return {
    file,
    execArgv: [...execArgv, "-r", require.resolve("ts-node/register/transpile-only")],
    env: { TS_NODE_PROJECT: path.resolve(__dirname, "../../../tsconfig.json") },
  };
}

const optionalText = z.string().nullish().transform((v) => v ?? undefined);
const transactionSchema = z.object({
  type: z.enum(["normal", "installments"]),
  date: z.string(),
  processedDate: z.string(),
  originalAmount: z.number(),
  originalCurrency: z.string(),
  chargedAmount: z.number(),
  chargedCurrency: optionalText,
  description: z.string(),
  memo: optionalText,
  status: z.enum(["completed", "pending"]),
  installments: z.object({ number: z.number(), total: z.number() }).nullish().transform((v) => v ?? undefined),
});
const resultSchema = z.object({
  success: z.boolean(),
  accounts: z.array(z.object({
    accountNumber: z.string(),
    balance: z.number().nullish().transform((v) => v ?? undefined),
    txns: z.array(transactionSchema).max(20_000),
  })).max(50).optional(),
  errorType: z.string().max(100).nullish().transform((v) => v ?? undefined),
  errorMessage: z.string().nullish().transform((v) => v?.slice(0, 500)),
});

/** Which fields came back filled, as counts — never a value, amount or account number. */
export function resultShape(result: ScrapeResult): string {
  if (!result.success) return `failed ${result.errorType ?? "?"}`;
  return `accounts=${result.accounts?.length ?? 0} ` + (result.accounts ?? []).map((account) => {
    const count = (has: (txn: (typeof account.txns)[number]) => boolean) => account.txns.filter(has).length;
    return `[txns=${account.txns.length} balance=${account.balance == null ? "no" : "yes"} pending=${count((t) => t.status === "pending")} installments=${count((t) => !!t.installments)} memo=${count((t) => !!t.memo)} processedDiffers=${count((t) => t.processedDate !== t.date)} foreign=${count((t) => t.originalCurrency !== "ILS")}]`;
  }).join(" ");
}

function workerEvent(message: unknown): WorkerEvent | null {
  if (typeof message !== "object" || message === null || !("type" in message)) return null;
  return message as WorkerEvent;
}

function startupError(event: Extract<WorkerEvent, { type: "error" }>): Error {
  if (event.code === "MISSING_LIBRARY") return ApiError.internal("רכיב החיבור לבנקים לא מותקן בשרת (npm i israeli-bank-scrapers בתיקיית backend).");
  if (event.code === "UNSUPPORTED") return ApiError.internal("גרסת רכיב החיבור לבנקים אינה נתמכת.");
  return new Error(`sync worker failed to start: ${event.message}`);
}

// The library's two names for "something failed": GENERIC from its own catch, GENERAL_ERROR from ours.
const GENERIC_ERRORS = ["GENERIC", "GENERAL_ERROR"];
const failed = (errorType: string, errorMessage: string): ScrapeResult => ({ success: false, errorType, errorMessage });

/** Each sync gets a fresh worker process; the parent alone decrypts credentials and touches the DB. */
export function isolatedScraperFactory({ library = LIBRARY, officialLibrary = OFFICIAL_LOGIN, hardLimitMs = HARD_LIMIT_MS, runRoot = RUN_ROOT, tmpRoot = os.tmpdir(), urlProbe = process.env.CONNECTION_URL_PROBE === "1" } = {}): ScraperFactory {
  return (options) => new Promise<ScraperRun>((resolveRun, rejectRun) => {
    mkdirSync(runRoot, { recursive: true, mode: 0o700 });
    const runDir = mkdtempSync(path.join(runRoot, `run-${process.pid}-`));
    // mkdtemp makes it 0700 under a fresh random name, so a shared /tmp is safe.
    const tmpDir = mkdtempSync(path.join(tmpRoot, `${TMP_PREFIX}${process.pid}-`));
    if (tmpDir.length + CHROME_SOCKET.length > MAX_SOCKET_PATH) {
      removeRun(runDir, tmpDir);
      rejectRun(ApiError.internal("תיקיית הקבצים הזמניים של השרת ארוכה מדי, ולכן הדפדפן לא יכול להיפתח. לא נוצר קשר עם הבנק."));
      return;
    }
    const entry = workerEntry();
    const headed = options.loginMethod === "official_window";
    let child: ReturnType<typeof fork>;
    try {
      child = fork(entry.file, [], {
        cwd: runDir,
        env: { ...workerEnv(process.env, { headed }), TMPDIR: tmpDir, ...entry.env },
        execArgv: entry.execArgv,
        detached: true,
        stdio: ["ignore", "ignore", "pipe", "ipc"],
        serialization: "json",
      });
    } catch (error) {
      removeRun(runDir, tmpDir);
      rejectRun(error);
      return;
    }
    let stderrBudget = STDERR_CAP;
    let partialLine = "";
    const logStderr = (text: string) => {
      if (!text.trim() || stderrBudget <= 0) return;
      const line = redactLog(text).slice(0, stderrBudget);
      stderrBudget -= line.length;
      console.warn(`[סנכרון] worker: ${line.trimEnd()}`);
    };
    // Whole lines only, so a URL or number split across two chunks is still redacted.
    child.stderr?.on("data", (chunk: Buffer) => {
      const lines = (partialLine + chunk.toString("utf8")).split("\n");
      partialLine = lines.pop() ?? "";
      for (const line of lines) logStderr(line);
    });
    let ready = false;
    let settled = false;
    let windowClosed = false;
    let browserStarted = false;
    let progressListener: (type: string) => void = () => {};
    let resolveScrape: (result: ScrapeResult) => void = () => {};
    const scrapeResult = new Promise<ScrapeResult>((resolve) => { resolveScrape = resolve; });

    // The worker's group first, so it cannot fork past the scan; then by cwd rather than by a
    // reported pid, since Chrome may still be starting, unreported, in a group of its own.
    const stop = () => {
      try { if (child.pid) process.kill(-child.pid, "SIGKILL"); } catch { /* already gone */ }
      killProcessesIn(runDir);
      removeRun(runDir, tmpDir);
    };
    const settle = (outcome: ScrapeResult | Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stop();
      if (!ready) { rejectRun(outcome instanceof Error ? outcome : new Error(outcome.errorMessage ?? "sync worker stopped")); return; }
      const result = outcome instanceof Error ? failed("GENERAL_ERROR", outcome.message) : outcome;
      // A generic failure before Chrome came up is a launch failure here, never the bank's answer.
      resolveScrape(!result.success && GENERIC_ERRORS.includes(result.errorType ?? "") && !browserStarted ? failed(BROWSER_LAUNCH, result.errorMessage ?? "") : result);
    };
    const timer = setTimeout(() => settle(failed("TIMEOUT", "sync worker exceeded its time limit")), hardLimitMs);

    child.on("message", (message: unknown) => {
      const event = workerEvent(message);
      if (!event || settled) return;
      if (event.type === "progress" && typeof event.progress === "string") {
        if (event.progress === BROWSER_CLOSED) windowClosed = true;
        if (event.progress === BROWSER_STARTED) { browserStarted = true; return; }
        progressListener(event.progress.slice(0, 64));
      }
      else if (event.type === "error") settle(ready ? failed("GENERAL_ERROR", String(event.message).slice(0, 500)) : startupError(event));
      else if (event.type === "result") {
        const parsed = resultSchema.safeParse(event.result);
        // officialLogin throws BROWSER_CLOSED when she closes the bank's window; the library reports it as generic.
        // A close during the fetch surfaces as "Target closed"; the progress event says whose doing it was.
        const closed = parsed.success && !parsed.data.success && (windowClosed || parsed.data.errorMessage === BROWSER_CLOSED);
        const tabClosed = parsed.success && !closed && parsed.data.errorMessage === BROWSER_TAB_CLOSED;
        if (urlProbe && parsed.success) console.warn(`[סנכרון] probe: ${resultShape(parsed.data)}`);
        settle(!parsed.success ? failed("GENERAL_ERROR", "unexpected scraper result")
          : closed ? failed(BROWSER_CLOSED, "browser window closed")
          : tabClosed ? failed(BROWSER_TAB_CLOSED, "bank tab closed") : parsed.data);
      } else if (event.type === "ready" && !ready) {
        ready = true;
        resolveRun({
          onProgress(listener) { progressListener = listener; },
          cancel() { settle(failed("CANCELLED", "cancelled by the user")); },
          scrape(credentials) {
            const command: WorkerCommand = { type: "scrape", credentials };
            if (!settled) child.send(command);
            return scrapeResult;
          },
        });
      }
    });
    child.on("error", (error) => settle(error));
    child.on("exit", (code, signal) => {
      logStderr(partialLine);
      partialLine = "";
      settle(failed("GENERAL_ERROR", `sync worker exited (${signal ?? code})`));
      // Chrome may outlive a worker that died on its own; the run directory goes either way.
      stop();
    });

    const start: WorkerCommand = {
      type: "start",
      library: headed ? officialLibrary : library,
      options: {
        companyId: options.companyId, startDate: options.startDate.toISOString(), defaultTimeout: options.defaultTimeout,
        showBrowser: headed, loginWaitMs: options.loginWaitMs, profileDir: path.join(runDir, "profile"), urlProbe: headed && urlProbe,
      },
    };
    child.send(start);
  });
}

export const createIsolatedScraper: ScraperFactory = isolatedScraperFactory();
