import { prisma } from "../../config/database";
import { ApiError } from "../../utils/ApiError";
import { json } from "../journey/journey.utils";
import { importSessions } from "../imports/importSession.service";
import type { LoginMethod, PendingRef, ScrapedAccount, ScrapedTransaction, ScrapeResult, SyncOutcomeItem, SyncPhase, SyncStatus } from "../../types/connections.types";
import { openCredentials } from "./credentialsCipher";
import { providerInfo, type ProviderInfo } from "./providers";
import { addDays, bankWorkbook, cardWorkbook, freshTransactions, israelDay, purchaseDay } from "./scrapeWorkbook";
import { processAlive } from "./runProcesses";
import type { ScraperFactory, ScraperRun } from "./scraperAdapter";
import { createIsolatedScraper, sweepStaleRuns } from "./scraperIsolation";
import { BROWSER_CLOSED } from "./scraperLaunch";
import { BLOCKING_ERRORS, retryBlock } from "./syncPolicy";

const FIRST_SYNC_DAYS = 90;
const APPROVAL_WAIT_MS = 180_000;
const PAGE_WAIT_MS = 60_000;
const OFFICIAL_LOGIN_WAIT_MS = 5 * 60_000;
const STALE_LOCK_MS = 60_000;
// Beyond the worker's own 15-minute hard limit: no live run can still be "running" by then.
const ABANDONED_SYNC_MS = 20 * 60_000;

/** The run this process holds per connection; the DB lock (syncLockedAt) covers other processes. */
interface RunControl {
  cancelled: boolean;
  /** Set the moment the rows are in hand; from then on a cancel is refused, not half-applied. */
  importing: boolean;
  scraper: ScraperRun | null;
}
const active = new Map<number, RunControl>();

type ConnectionRow = NonNullable<Awaited<ReturnType<typeof prisma.financialConnection.findFirst>>>;

function failureMessage(provider: ProviderInfo, errorType: string | undefined, method: LoginMethod = "password"): string {
  if (method === "official_window") {
    switch (errorType) {
      case "TIMEOUT": return `הכניסה בחלון של ${provider.name} לא הסתיימה תוך ${OFFICIAL_LOGIN_WAIT_MS / 60_000} דקות. אפשר לנסות שוב.`;
      case BROWSER_CLOSED: return `חלון ${provider.name} נסגר לפני שהכניסה והקריאה הסתיימו. לא נוסף דבר.`;
      case "CANCELLED": return "הרענון בוטל. לא נוסף דבר.";
      default: return `הכניסה בחלון של ${provider.name} או קריאת הנתונים נכשלו — ייתכן שהאתר השתנה. אפשר להמשיך להעלות דף חשבון כקובץ.`;
    }
  }
  const approval = provider.approvalHint
    ? " אם הבנק ביקש אישור באפליקציה, ייתכן שלא אושר בזמן או שהמסך שהופיע עדיין לא נתמך בחיבור. אפשר להמשיך להעלות דף חשבון כקובץ."
    : "";
  switch (errorType) {
    case "INVALID_PASSWORD": return "שם המשתמש או הסיסמה שגויים. לא ננסה שוב אוטומטית, כדי שהחשבון באתר לא יינעל.";
    case "CHANGE_PASSWORD": return `האתר של ${provider.name} מבקש להחליף סיסמה. יש להחליף אותה באתר ואז לעדכן אותה כאן.`;
    case "ACCOUNT_BLOCKED": return `החשבון באתר של ${provider.name} חסום. יש לפנות אליהם.`;
    case "CANCELLED": return "הרענון בוטל. לא נוסף דבר.";
    case "TWO_FACTOR_RETRIEVER_MISSING": return `האתר של ${provider.name} מבקש קוד אימות, ותהליך כזה עדיין לא נתמך בחיבור. אפשר להמשיך להעלות קבצים.`;
    case "TIMEOUT": return `האתר של ${provider.name} לא סיים את הכניסה בזמן.${approval}`;
    default: return `הכניסה או קריאת הנתונים מ־${provider.name} נכשלו — ייתכן שהאתר השתנה.${approval}`;
  }
}

function lastDigits(accountNumber: string): string {
  return accountNumber.replace(/\D/g, "").slice(-4);
}

// Conditional on "running": a final status is final, so a late write from a dying run cannot undo a cancel.
async function finish(syncId: number, status: SyncStatus, message: string | null, outcome: SyncOutcomeItem[] = [], errorType: string | null = null) {
  await prisma.connectionSync.updateMany({
    where: { id: syncId, status: "running" },
    data: { status, message: message?.slice(0, 500) ?? null, errorType, outcome: json(outcome), finishedAt: new Date() },
  });
}

/**
 * Watermarks: rows on or before a day are already stored. A sync's own rows get
 * an overlap (a card row can post days after its purchase) because the same
 * wording comes back and duplicate review matches it exactly. A file's last day is
 * reopened itself — the file may have closed before that day did — and a differently
 * worded copy of a row it held is caught by the sync's near-duplicate review (banker 2026-10-17).
 */
interface Target {
  key: string;
  label: string;
  storedThrough: string | null;
  /** Card only, by charge date — a later instalment of an old purchase is still new. */
  chargedThrough: string | null;
  /** The file watermarks alone: a pending row never reopens the window below them. */
  filesThrough: string | null;
  filesChargedThrough: string | null;
  answers: { kind: "bank"; accountId: number } | { kind: "credit"; cardId: number } | null;
}

export const SYNC_FILE_PREFIX = "סנכרון ";
const OVERLAP_DAYS = { bank: 3, card: 14 };

const day = (date: Date | null | undefined) => date?.toISOString().slice(0, 10) ?? null;
const fileEdge = (date: Date | null | undefined) => { const last = day(date); return last === null ? null : addDays(last, -1); };
const firstSyncDay = () => addDays(israelDay(new Date().toISOString()), -FIRST_SYNC_DAYS);
const later = (a: string | null, b: string | null) => (a === null ? b : b === null || a > b ? a : b);

// A card statement holds its whole charge cycle, so by charge date a file's last day is complete.
function watermark(fromSync: Date | null, fromFiles: Date | null, overlap: number, fileDay: typeof day = fileEdge): string | null {
  const synced = day(fromSync);
  return later(synced === null ? null : addDays(synced, -overlap), fileDay(fromFiles));
}

const syncedFile = { startsWith: SYNC_FILE_PREFIX };

async function bankTarget(accountId: number, label: string): Promise<Target> {
  const [synced, files] = await Promise.all([
    prisma.bankTransaction.aggregate({ where: { bankAccountId: accountId, statementImport: { is: { fileName: syncedFile } } }, _max: { transactionDate: true } }),
    prisma.bankTransaction.aggregate({ where: { bankAccountId: accountId, OR: [{ statementImportId: null }, { statementImport: { is: { fileName: { not: syncedFile } } } }] }, _max: { transactionDate: true } }),
  ]);
  return { key: `bank:${accountId}`, label, storedThrough: watermark(synced._max.transactionDate, files._max.transactionDate, OVERLAP_DAYS.bank), chargedThrough: null, filesThrough: fileEdge(files._max.transactionDate), filesChargedThrough: null, answers: { kind: "bank", accountId } };
}

async function cardTarget(cardId: number, label: string): Promise<Target> {
  const [synced, files] = await Promise.all([
    prisma.creditTransaction.aggregate({ where: { cardId, creditImport: { fileName: syncedFile } }, _max: { transactionDate: true, chargeDate: true } }),
    prisma.creditTransaction.aggregate({ where: { cardId, creditImport: { fileName: { not: syncedFile } } }, _max: { transactionDate: true, chargeDate: true } }),
  ]);
  return {
    key: `card:${cardId}`, label,
    storedThrough: watermark(synced._max.transactionDate, files._max.transactionDate, OVERLAP_DAYS.card),
    chargedThrough: watermark(synced._max.chargeDate, files._max.chargeDate, OVERLAP_DAYS.card, day),
    filesThrough: fileEdge(files._max.transactionDate), filesChargedThrough: day(files._max.chargeDate),
    answers: { kind: "credit", cardId },
  };
}

/**
 * Rows still pending last time may settle with another amount or name, so the
 * window reopens to their day — but never below what a file already covered.
 */
function windowFor(target: Target, carried: PendingRef[]): { after: string; chargeAfter: string } {
  const pendingFloor = carried.length ? addDays(carried.map((ref) => ref.date).sort()[0], -1) : null;
  const reopen = (stored: string | null, files: string | null) => {
    const base = stored ?? addDays(firstSyncDay(), -1);
    return later(pendingFloor !== null && pendingFloor < base ? pendingFloor : base, files)!;
  };
  return {
    after: reopen(target.storedThrough, target.filesThrough),
    chargeAfter: reopen(target.chargedThrough ?? target.storedThrough, target.filesChargedThrough ?? target.filesThrough),
  };
}

function isNewFor(target: Target, carried: PendingRef[]): (txn: ScrapedTransaction) => boolean {
  const { after, chargeAfter } = windowFor(target, carried);
  if (target.answers?.kind !== "credit") return (t) => israelDay(t.date) > after;
  const filesEnd = target.filesThrough && addDays(target.filesThrough, 1);
  const filesCharged = target.filesChargedThrough;
  return (t) => purchaseDay(t) > after
    || (!!t.installments && t.installments.number > 1 && israelDay(t.processedDate) > chargeAfter)
    // Bought within the files' period but charged after the last file's charge day: no uploaded file can hold it.
    || (filesEnd !== null && filesCharged !== null && purchaseDay(t) <= filesEnd && israelDay(t.processedDate) > filesCharged);
}

async function carriedPending(connectionId: number): Promise<Map<string, PendingRef[]>> {
  const last = await prisma.connectionSync.findFirst({ where: { connectionId, status: "succeeded" }, orderBy: { id: "desc" } });
  const items = Array.isArray(last?.outcome) ? (last.outcome as unknown as SyncOutcomeItem[]) : [];
  return new Map(items.map((item) => [item.key, Array.isArray(item.pending) ? item.pending : []]));
}

// A newer sync covers everything the older one offered; two open sessions with the same rows could both be approved.
async function cancelUnapproved(userId: number, connectionId: number, key: string) {
  const previous = await prisma.connectionSync.findMany({ where: { connectionId, status: "succeeded" }, select: { outcome: true } });
  const ids = previous.flatMap((p) => (Array.isArray(p.outcome) ? (p.outcome as unknown as SyncOutcomeItem[]) : []))
    .filter((item) => item.key === key && item.importSessionId).map((item) => item.importSessionId!);
  // An approved session can no longer be cancelled — `cancel` refuses it, which is the point.
  for (const id of ids) await importSessions.cancel(userId, id).catch(() => undefined);
}

async function importTarget(userId: number, connectionId: number, provider: ProviderInfo, target: Target, txns: ScrapedTransaction[], carried: PendingRef[], siteBalance: number | null = null): Promise<SyncOutcomeItem> {
  const fresh = freshTransactions(txns, isNewFor(target, carried));
  const workbook = target.answers?.kind === "credit" || !target.answers && provider.kind === "card" ? cardWorkbook(fresh) : bankWorkbook(fresh);
  const base = { key: target.key, target: target.label, rows: workbook.rows, skippedPending: workbook.skippedPending, skippedForeign: workbook.skippedForeign, skippedZero: workbook.skippedZero, storedThrough: target.storedThrough, pending: workbook.pending, foreign: workbook.foreign, siteBalance };
  if (!target.answers) return { ...base, importSessionId: null, note: `${target.label} לא מוגדר במערכת. יש להוסיף אותו במסך הכרטיסים ולרענן שוב — התנועות שלו יילקחו אז.` };
  await cancelUnapproved(userId, connectionId, target.key);
  if (!workbook.rows) return { ...base, importSessionId: null, note: "אין תנועות חדשות" };
  const fileName = `${SYNC_FILE_PREFIX}${provider.name} ${target.label} ${israelDay(new Date().toISOString())}.xlsx`;
  const session = await importSessions.create(userId, fileName, workbook.buffer, target.answers, "sync");
  // An identical file returns its earlier session, which may already be approved.
  if (["review", "completed"].includes(session.status)) return { ...base, importSessionId: null, note: "התנועות האלה כבר נקלטו" };
  return { ...base, importSessionId: session.id };
}

function pickBankAccount(connection: ConnectionRow, accounts: ScrapedAccount[]): ScrapedAccount {
  const hint = connection.accountHint?.replace(/\D/g, "");
  const matches = hint ? accounts.filter((a) => a.accountNumber.replace(/\D/g, "").endsWith(hint)) : accounts;
  if (matches.length !== 1) {
    const endings = accounts.map((a) => lastDigits(a.accountNumber)).join(", ");
    const ask = hint ? `הספרות שנשמרו בחיבור (${hint}) לא מתאימות לאף אחד מהם — יש לתקן אותן.` : "יש לכתוב בחיבור את ספרות החשבון הרצוי.";
    throw ApiError.badRequest(`בכניסה הזו יש ${accounts.length} חשבונות (מסתיימים ב־${endings}). ${ask}`);
  }
  return matches[0];
}

function validAccounts(result: ScrapeResult): ScrapedAccount[] {
  return (result.accounts ?? []).filter((a) => typeof a.accountNumber === "string" && Array.isArray(a.txns));
}

/** One scrape window for the whole login: the oldest day any of its targets still needs. */
function scrapeFrom(targets: Target[], carried: Map<string, PendingRef[]>): Date {
  const days = targets.length
    ? targets.flatMap((t) => Object.values(windowFor(t, carried.get(t.key) ?? [])))
    : [addDays(firstSyncDay(), -1), ...[...carried.values()].flat().map((ref) => addDays(ref.date, -1))];
  // The library dates rows at Israeli midnight (21:00Z the day before); a day's margin keeps the first day, isNew trims the extra.
  return new Date(`${days.sort()[0]}T00:00:00Z`);
}

function setPhase(syncId: number, phase: SyncPhase, deadlineAt: Date | null = null) {
  return prisma.connectionSync.updateMany({ where: { id: syncId, status: "running" }, data: { phase, deadlineAt } });
}

async function run(userId: number, connection: ConnectionRow, syncId: number, factory: ScraperFactory, control: RunControl): Promise<void> {
  const provider = providerInfo(connection.provider);
  if (!provider) return finish(syncId, "failed", "ספק החיבור אינו נתמך");
  const method = connection.loginMethod as LoginMethod;
  // Chained so a late progress write can never overwrite the final status.
  let progress: Promise<unknown> = Promise.resolve();
  try {
    if (method === "password" && !connection.credentials) throw ApiError.badRequest("חסרים פרטי כניסה לחיבור הזה");
    const credentials = method === "password" ? openCredentials(userId, connection.credentials!) : {};
    if (provider.kind === "bank" && !connection.bankAccountId) throw ApiError.badRequest("יש לבחור לאיזה חשבון בנק במערכת נכנסות התנועות");
    const cards = provider.kind === "card" ? await prisma.creditCard.findMany({ where: { userId }, select: { id: true, lastFour: true } }) : [];
    const known = provider.kind === "bank"
      ? [await bankTarget(connection.bankAccountId!, "חשבון הבנק")]
      : await Promise.all(cards.map((c) => cardTarget(c.id, `כרטיס ${c.lastFour}`)));
    const carried = await carriedPending(connection.id);
    const defaultTimeout = method === "password" && provider.approvalHint ? APPROVAL_WAIT_MS : PAGE_WAIT_MS;
    const scraper = await factory({ companyId: provider.id, startDate: scrapeFrom(known, carried), defaultTimeout, loginMethod: method, loginWaitMs: OFFICIAL_LOGIN_WAIT_MS });
    control.scraper = scraper;
    if (control.cancelled) scraper.cancel();
    await setPhase(syncId, "launching");
    scraper.onProgress((type) => {
      // LOGGING_IN fires once the form is submitted (password) or the bank's page is open (official window).
      // It says nothing about whether the bank asked for an approval, so the phase does not claim one.
      const next: [SyncPhase, Date | null] | null = type === "LOGGING_IN"
        ? [method === "official_window" ? "awaiting_user" : "awaiting_bank", new Date(Date.now() + (method === "official_window" ? OFFICIAL_LOGIN_WAIT_MS : defaultTimeout))]
        : type === "LOGIN_SUCCESS" ? ["fetching", null] : null;
      if (next) progress = progress.then(() => setPhase(syncId, ...next)).catch((error: unknown) => console.error("[סנכרון] עדכון מצב נכשל", error));
    });
    const result = await scraper.scrape(credentials);
    await progress;
    // Checked and flagged in one synchronous step, so cancel() either wins here or is refused.
    control.importing = true;
    // A cancel she sent while the fetch was finishing still wins: nothing read after it is offered.
    if (control.cancelled) return finish(syncId, "cancelled", failureMessage(provider, "CANCELLED", method), [], "CANCELLED");
    if (!result.success) {
      console.warn(`[סנכרון] ${provider.name}: נכשל (${result.errorType ?? "לא ידוע"})`);
      if (result.errorType === "CANCELLED") return finish(syncId, "cancelled", failureMessage(provider, "CANCELLED", method), [], "CANCELLED");
      // In the official window she types nothing of ours; a "wrong password" there is not a stored-credentials problem.
      if (method === "password" && (BLOCKING_ERRORS as readonly string[]).includes(result.errorType ?? "")) {
        await prisma.financialConnection.update({ where: { id: connection.id }, data: { blockedReason: result.errorType } });
      }
      return finish(syncId, "failed", failureMessage(provider, result.errorType, method), [], result.errorType ?? "GENERAL_ERROR");
    }
    await setPhase(syncId, "building_import");
    await prisma.financialConnection.update({ where: { id: connection.id }, data: { verifiedAt: connection.verifiedAt ?? new Date() } });
    const accounts = validAccounts(result);
    const outcome: SyncOutcomeItem[] = [];
    if (provider.kind === "bank") {
      const account = pickBankAccount(connection, accounts);
      outcome.push(await importTarget(userId, connection.id, provider, known[0], account.txns, carried.get(known[0].key) ?? [], account.balance ?? null));
    } else {
      for (const account of accounts) {
        const digits = lastDigits(account.accountNumber);
        const card = cards.find((c) => c.lastFour === digits);
        const target = card ? known[cards.indexOf(card)] : { key: `card-digits:${digits}`, label: `כרטיס ${digits}`, storedThrough: null, chargedThrough: null, filesThrough: null, filesChargedThrough: null, answers: null };
        outcome.push(await importTarget(userId, connection.id, provider, target, account.txns, carried.get(target.key) ?? []));
      }
    }
    await prisma.financialConnection.update({ where: { id: connection.id }, data: { lastSyncAt: new Date() } });
    const ready = outcome.filter((o) => o.importSessionId).length;
    console.log(`[סנכרון] ${provider.name}: ${outcome.map((o) => `${o.target} — ${o.rows} שורות בחלון, ${o.skippedPending} בהמתנה, ${o.skippedForeign} במטבע זר, ${o.skippedZero} בסכום 0`).join(" · ") || "לא נמצאו חשבונות"}`);
    await finish(syncId, "succeeded", ready === 1 ? "דוח אחד מחכה לאישור במסך הייבוא" : ready ? `${ready} דוחות מחכים לאישור במסך הייבוא` : "לא נמצאו תנועות חדשות לאישור", outcome);
  } catch (error) {
    await progress;
    const message = error instanceof ApiError ? error.message : failureMessage(provider, undefined, method);
    console.error(`[סנכרון] ${provider.name}: שגיאה`, error instanceof Error ? error.message : error);
    await finish(syncId, "failed", message, [], error instanceof ApiError ? "APP" : "GENERAL_ERROR");
  }
}

/** Only the holder releases: the claim's own timestamp is its token. */
const releaseLock = (connectionId: number, claimedAt: Date) => prisma.financialConnection.updateMany({ where: { id: connectionId, syncLockedAt: claimedAt }, data: { syncLockedAt: null } });

async function lastSyncOf(connectionId: number) {
  return prisma.connectionSync.findFirst({ where: { connectionId }, orderBy: { id: "desc" }, select: { status: true, errorType: true, finishedAt: true } });
}

export const connectionSync = {
  /**
   * Starts one connection's sync in the background. A failure is recorded on its own sync row only.
   * The DB lock is claimed atomically, so a double click or a second server cannot log in twice.
   */
  async start(userId: number, connectionId: number, factory: ScraperFactory = createIsolatedScraper) {
    const connection = await prisma.financialConnection.findFirst({ where: { id: connectionId, userId } });
    if (!connection) throw ApiError.notFound("החיבור לא נמצא");
    const refuse = (last: Awaited<ReturnType<typeof lastSyncOf>>, current: { loginMethod: string; blockedReason: string | null }) => {
      if (last?.status === "running" || active.has(connectionId)) return ApiError.conflict("הסנכרון של החיבור הזה כבר רץ");
      const block = retryBlock(current, last);
      return block ? (block.reason === "cooldown" ? ApiError.tooManyRequests(block.message) : ApiError.conflict(block.message)) : null;
    };
    const early = refuse(await lastSyncOf(connectionId), connection);
    if (early) throw early;
    const claimedAt = new Date();
    const { count } = await prisma.financialConnection.updateMany({ where: { id: connectionId, userId, syncLockedAt: null }, data: { syncLockedAt: claimedAt } });
    if (!count) throw ApiError.conflict("הסנכרון של החיבור הזה כבר רץ");
    // Re-read under the lock: a run that ended between the check and the claim may have just blocked retries.
    const locked = await prisma.financialConnection.findUniqueOrThrow({ where: { id: connectionId } });
    const late = refuse(await lastSyncOf(connectionId), locked);
    if (late) {
      await releaseLock(connectionId, claimedAt);
      throw late;
    }
    const control: RunControl = { cancelled: false, importing: false, scraper: null };
    active.set(connectionId, control);
    let sync;
    try {
      sync = await prisma.connectionSync.create({ data: { connectionId, userId, status: "running", phase: "queued", method: connection.loginMethod, ownerPid: process.pid } });
    } catch (error) {
      active.delete(connectionId);
      await releaseLock(connectionId, claimedAt);
      throw error;
    }
    const done = run(userId, locked, sync.id, factory, control)
      .catch((error: unknown) => console.error("[סנכרון] כשל לא צפוי", error))
      .finally(async () => {
        active.delete(connectionId);
        await releaseLock(connectionId, claimedAt).catch((error: unknown) => console.error("[סנכרון] שחרור נעילה נכשל", error));
      });
    return { sync, done };
  },

  /** Stops a login or fetch this process runs. Once the rows are read, the import screen is where to reject them. */
  async cancel(userId: number, connectionId: number) {
    const sync = await prisma.connectionSync.findFirst({ where: { connectionId, userId, status: "running" }, orderBy: { id: "desc" } });
    if (!sync) throw ApiError.conflict("אין רענון פעיל לבטל");
    const control = active.get(connectionId);
    if (!control) throw ApiError.conflict("הרענון רץ בתהליך שרת אחר ולא ניתן לבטל אותו מכאן.");
    if (control.importing) throw ApiError.conflict("התנועות כבר נקראו ומוכנות לבדיקה. אפשר לדחות אותן במסך הייבוא.");
    control.cancelled = true;
    control.scraper?.cancel();
    await prisma.connectionSync.updateMany({ where: { id: sync.id }, data: { cancelRequestedAt: new Date() } });
  },

  /**
   * A restart kills the browser mid-login; its sync must not look alive forever. Only syncs whose
   * process is gone are failed — a test run or a second server must not end a live one.
   */
  async failInterrupted() {
    const running = await prisma.connectionSync.findMany({ where: { status: "running" }, select: { id: true, connectionId: true, ownerPid: true, startedAt: true } });
    const abandonedBefore = Date.now() - ABANDONED_SYNC_MS;
    // The age check covers a dead owner whose pid was since reused by an unrelated process.
    const orphaned = running.filter((s) => s.ownerPid === null || s.startedAt.getTime() < abandonedBefore
      || (s.ownerPid === process.pid ? !active.has(s.connectionId) : !processAlive(s.ownerPid)));
    if (orphaned.length) {
      await prisma.connectionSync.updateMany({
        where: { id: { in: orphaned.map((s) => s.id) }, status: "running" },
        data: { status: "failed", errorType: "INTERRUPTED", message: "השרת הופעל מחדש באמצע הסנכרון. אפשר לנסות שוב.", finishedAt: new Date() },
      });
      console.warn(`[סנכרון] ${orphaned.length} סנכרונים שנקטעו סומנו ככושלים`);
    }
    const live = running.filter((s) => !orphaned.includes(s)).map((s) => s.connectionId);
    // An orphan's lock goes at once; a lock with no sync row at all (a crash between claim and create) after a minute.
    await prisma.financialConnection.updateMany({
      where: {
        id: { notIn: [...live, ...active.keys()] },
        OR: [{ id: { in: orphaned.map((s) => s.connectionId) } }, { syncLockedAt: { lt: new Date(Date.now() - STALE_LOCK_MS) } }],
      },
      data: { syncLockedAt: null },
    });
    const swept = sweepStaleRuns();
    if (swept) console.warn(`[סנכרון] נוקו ${swept} תיקיות דפדפן שנשארו מסנכרון שנקטע`);
  },
};
