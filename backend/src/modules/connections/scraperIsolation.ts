import { fork } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { ApiError } from "../../utils/ApiError";
import type { DepartmentFollowUp, LoanFollowUpDecision, LoanFollowUpReport, ScrapeExtras, ScrapeResult, WorkerCommand, WorkerEvent } from "../../types/connections.types";
import type { ScraperFactory, ScraperOptions, ScraperRun } from "./scraperAdapter";
import { openProbeLog, PROBE_ROOT } from "./probeLog";
import { killProcessesIn, processAlive } from "./runProcesses";
import { BROWSER_CLOSED, BROWSER_LAUNCH, BROWSER_STARTED, BROWSER_TAB_CLOSED, FOLLOW_UP_DECISION_MS, PROBE_DONE, PROBE_SIGNED_IN } from "./scraperLaunch";
import { hasLongNumber } from "./departmentTables.parser";
import { DEPARTMENT_STOPS, departmentReadList } from "./siteDepartments";

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

/**
 * Worker stderr can carry bank URLs (with query tokens), emails or account digits from a stack trace,
 * and a library error may echo what it was given — so her own credential values go first.
 */
export function redactLog(text: string, secrets: readonly string[] = []): string {
  const hidden = secrets.filter((secret) => secret.length >= 3).reduce((out, secret) => out.split(secret).join("<secret>"), text);
  return hidden.replace(/https?:\/\/\S+/g, "<url>").replace(/\S+@\S+/g, "<email>").replace(/\d[\d-]{2,}\d/g, "<num>").slice(0, STDERR_CAP);
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

const amount = z.number().finite().nullable();
const day = z.string().max(40);
// §7 A2: a number read from a bank page arrives as its last 4 digits; a longer one, even split by separators, is a leak.
const lastDigits = z.string().regex(/^\d{1,4}$/);
const shortNumbersOnly = (max: number) => z.string().max(max).refine((text) => !hasLongNumber(text), "more than 4 digits");
const loanPaymentSchema = z.strictObject({
  paymentNumber: z.number().int().positive(), date: day, principal: amount, interest: amount, linkage: amount, total: amount, balanceAfter: amount,
});
const loanSchema = z.strictObject({
  loanNumber: lastDigits, trackNumber: lastDigits.nullable(), name: shortNumbersOnly(200).nullable(), asOf: day.nullable(),
  originalAmount: amount, principalBalance: amount, indexedBalance: amount, interestType: z.enum(["fixed", "prime", "variable"]).nullable(),
  annualInterestRate: amount, primeMargin: amount, indexLinked: z.boolean().nullable(), baseIndex: amount, baseIndexMonth: z.string().max(7).nullable(),
  paymentsMade: z.number().int().nonnegative().nullable(), paymentsTotal: z.number().int().positive().nullable(), startDate: day.nullable(), endDate: day.nullable(),
  nextPaymentAmount: amount, nextPaymentDate: day.nullable(), schedule: z.array(loanPaymentSchema).max(1_000),
});
const standingOrderSchema = z.strictObject({
  payee: shortNumbersOnly(60).pipe(z.string().min(1)), amount, dayOfMonth: z.number().int().min(1).max(31).nullable(),
  kind: z.enum(["standing_order", "direct_debit"]).nullable(), status: z.enum(["active", "inactive"]).nullable(),
  reference: lastDigits.nullable(), lastChargeDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
});
const departmentReportSchema = z.strictObject({
  department: z.enum([...DEPARTMENT_STOPS, "landed", "NO_DECISION", "NOT_NEEDED"]),
  details: z.enum(["NOT_APPROVED", "READ", "UNAVAILABLE", "FAILED", "NOT_RUN"]),
  rejected: z.number().int().min(0).max(500).optional(),
});
const followUpSchema = departmentReportSchema.extend({ standingOrders: departmentReportSchema.optional() });
// Strict, so a field the bank renamed fails loudly instead of vanishing like an unknown key in resultSchema.
const extrasSchema = z.strictObject({
  loans: z.array(loanSchema).max(50).optional(),
  standingOrders: z.array(standingOrderSchema).max(100).optional(),
  followUp: followUpSchema.optional(),
  errors: z.array(z.enum(["EXTRAS_INVALID"])).max(10).default([]),
});

/** Parsed on its own: a malformed extra is reported as such and never fails the checking account's result. */
export function parseExtras(raw: unknown): ScrapeExtras | undefined {
  if (raw === undefined) return undefined;
  const parsed = extrasSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  // Malformed loans must not also hide how far the follow-up got: its codes are checked on their own.
  const followUp = typeof raw === "object" && raw !== null && "followUp" in raw ? followUpSchema.safeParse(raw.followUp) : null;
  return followUp?.success ? { followUp: followUp.data, errors: ["EXTRAS_INVALID"] } : { errors: ["EXTRAS_INVALID"] };
}

/** Which fields came back filled, as counts — never a value, amount or account number. */
export function resultShape(result: ScrapeResult): string {
  if (!result.success) return `failed ${result.errorType ?? "?"}`;
  const accounts = [`accounts=${result.accounts?.length ?? 0}`, ...(result.accounts ?? []).map((account) => {
    const count = (has: (txn: (typeof account.txns)[number]) => boolean) => account.txns.filter(has).length;
    return `[txns=${account.txns.length} balance=${account.balance == null ? "no" : "yes"} pending=${count((t) => t.status === "pending")} installments=${count((t) => !!t.installments)} memo=${count((t) => !!t.memo)} processedDiffers=${count((t) => t.processedDate !== t.date)} foreign=${count((t) => t.originalCurrency !== "ILS")}]`;
  })].join(" ");
  if (!result.extras) return accounts;
  const loans = result.extras.loans ?? [];
  const { followUp: report, standingOrders } = result.extras;
  const codes = (r: DepartmentFollowUp) => `${r.department}/${r.details}${r.rejected ? ` rejected=${r.rejected}` : ""}`;
  const orders = report?.standingOrders ? ` standingOrders=${codes(report.standingOrders)}` : "";
  const followUp = report ? ` followUp=${codes(report)}${orders}` : "";
  return `${accounts} extras=[loans=${loans.length}${standingOrders ? ` orders=${standingOrders.length}` : ""} schedules=${loans.filter((l) => l.schedule.length).length} payments=${loans.reduce((n, l) => n + l.schedule.length, 0)} errors=${result.extras.errors.join(",") || "none"}${followUp}]`;
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

/** The parent's answer, inside the worker's own wait so it never times out first; anything else means no follow-up. */
const NO_MOVE: LoanFollowUpDecision = { loans: false, standingOrders: false };
async function followUpDecision(decide: ScraperOptions["decideFollowUp"], checking: ScrapeResult): Promise<LoanFollowUpDecision> {
  if (!decide) return NO_MOVE;
  let timer: NodeJS.Timeout | undefined;
  try {
    const decision = await Promise.race([
      decide(checking),
      new Promise<LoanFollowUpDecision>((resolve) => { timer = setTimeout(() => resolve(NO_MOVE), FOLLOW_UP_DECISION_MS - 1_000); }),
    ]);
    return { loans: decision.loans === true, standingOrders: decision.standingOrders === true };
  } catch {
    console.warn("[סנכרון] ההחלטה על מעבר לדפי המחלקות נכשלה — ממשיכים בלי מעבר");
    return NO_MOVE;
  } finally {
    clearTimeout(timer);
  }
}

/** Each sync gets a fresh worker process; the parent alone decrypts credentials and touches the DB. */
export function isolatedScraperFactory({ library = LIBRARY, officialLibrary = OFFICIAL_LOGIN, hardLimitMs = HARD_LIMIT_MS, runRoot = RUN_ROOT, tmpRoot = os.tmpdir(), urlProbe = process.env.CONNECTION_URL_PROBE === "1", siteDiscovery = process.env.CONNECTION_SITE_DISCOVERY === "1", loansDepartment = process.env.CONNECTION_LOANS_DEPARTMENT === "1", departmentRead = departmentReadList(process.env.CONNECTION_DEPARTMENT_READ), probeRoot = PROBE_ROOT } = {}): ScraperFactory {
  return (options) => new Promise<ScraperRun>((resolveRun, rejectRun) => {
    // Only officialLogin stops after her sign-in; the library's password login would read her account.
    // Discovery moves the bank's app, so it never runs as a normal sync that would also import.
    if (siteDiscovery && !urlProbe) {
      rejectRun(ApiError.badRequest("מעבר בין דפי המחלקות פועל רק בהקלטת מבנה האתר. הדפדפן לא נפתח ולא נוצר קשר עם הבנק."));
      return;
    }
    if (urlProbe && options.loginMethod !== "official_window") {
      rejectRun(ApiError.badRequest("הקלטת מבנה האתר פועלת רק בכניסה בחלון הרשמי של הבנק. הדפדפן לא נפתח ולא נוצר קשר עם הבנק."));
      return;
    }
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
    let secrets: string[] = [];
    let partialLine = "";
    const logStderr = (text: string) => {
      if (!text.trim() || stderrBudget <= 0) return;
      const line = redactLog(text, secrets).slice(0, stderrBudget);
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
    let probeSignedIn = false;
    // The follow-up exception to "discovery never runs in an importing sync": default off, official window only (§7 clause A, A2).
    const followUpAsked = (loansDepartment || departmentRead.length > 0) && !urlProbe && headed;
    let checkingSeen = false;
    let early: ScrapeResult | null = null;
    const probeLog = urlProbe ? openProbeLog(probeRoot) : null;
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
      const probed = probeLog?.close();
      if (probed) console.warn(`[סנכרון] probe: ${probed.written} שורות נכתבו ל־${probed.file ?? "(אין קובץ)"}, ${probed.dropped} נשמטו מעבר לתקרה, ${probed.rejected} נדחו`);
      if (!ready) { rejectRun(outcome instanceof Error ? outcome : new Error(outcome.errorMessage ?? "sync worker stopped")); return; }
      const ended = outcome instanceof Error ? failed("GENERAL_ERROR", outcome.message) : outcome;
      // The follow-up never costs the checking rows already read; only her own cancel discards them.
      const department = windowClosed || [BROWSER_CLOSED, BROWSER_TAB_CLOSED].includes(ended.errorType ?? "") ? "CLOSED" : "ERROR";
      const result = !ended.success && ended.errorType !== "CANCELLED" && early
        ? { ...early, extras: { errors: [], followUp: { department, details: "NOT_RUN" } satisfies LoanFollowUpReport } }
        : ended;
      if (result !== ended) console.warn(`[סנכרון] הסנכרון נקטע אחרי קריאת העו״ש (${department}) — נקלטות התנועות שכבר נקראו`);
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
        if (event.progress === PROBE_SIGNED_IN) { probeSignedIn = true; return; }
        progressListener(event.progress.slice(0, 64));
      }
      else if (event.type === "probe") probeLog?.write(event.line);
      else if (event.type === "checking") {
        if (!followUpAsked || checkingSeen) return;
        checkingSeen = true;
        const checking = resultSchema.safeParse(event.result);
        if (checking.success && checking.data.success) early = checking.data;
        const decided = early ? followUpDecision(options.decideFollowUp, early) : Promise.resolve(NO_MOVE);
        void decided.then((decision) => {
          const command: WorkerCommand = { type: "followUp", decision };
          try { if (!settled) child.send(command); } catch { /* the worker is gone; its exit settles the run */ }
        });
      }
      else if (event.type === "error") settle(ready ? failed("GENERAL_ERROR", String(event.message).slice(0, 500)) : startupError(event));
      else if (event.type === "result") {
        const checking = resultSchema.safeParse(event.result);
        const extras = checking.success && checking.data.success && typeof event.result === "object" && event.result !== null && "extras" in event.result
          ? parseExtras(event.result.extras) : undefined;
        const parsed = checking.success && extras ? { ...checking, data: { ...checking.data, extras } } : checking;
        // officialLogin throws BROWSER_CLOSED when she closes the bank's window; the library reports it as generic.
        // A close during the fetch surfaces as "Target closed"; the progress event says whose doing it was.
        const closed = parsed.success && !parsed.data.success && (windowClosed || parsed.data.errorMessage === BROWSER_CLOSED);
        const tabClosed = parsed.success && !closed && parsed.data.errorMessage === BROWSER_TAB_CLOSED;
        if (urlProbe && parsed.success) console.warn(`[סנכרון] probe: ${resultShape(parsed.data)}`);
        // A probe run imports nothing, whatever came back: after her sign-in it ends here, even as a "success".
        const probeDone = urlProbe && parsed.success && (parsed.data.success || probeSignedIn || parsed.data.errorMessage === PROBE_DONE);
        settle(!parsed.success ? failed("GENERAL_ERROR", "unexpected scraper result")
          : probeDone ? failed(PROBE_DONE, "probe run: nothing read or imported")
          : closed ? failed(BROWSER_CLOSED, "browser window closed")
          : tabClosed ? failed(BROWSER_TAB_CLOSED, "bank tab closed") : parsed.data);
      } else if (event.type === "ready" && !ready) {
        ready = true;
        resolveRun({
          onProgress(listener) { progressListener = listener; },
          cancel() { settle(failed("CANCELLED", "cancelled by the user")); },
          scrape(credentials) {
            secrets = Object.values(credentials);
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
        showBrowser: headed, loginWaitMs: options.loginWaitMs, profileDir: path.join(runDir, "profile"), urlProbe, siteDiscovery,
        ...(followUpAsked ? { loansDepartment: true, departmentRead } : {}),
      },
    };
    child.send(start);
  });
}

export const createIsolatedScraper: ScraperFactory = isolatedScraperFactory();
