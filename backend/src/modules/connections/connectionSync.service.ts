import path from "node:path";
import { mkdir } from "node:fs/promises";
import { prisma } from "../../config/database";
import { ApiError } from "../../utils/ApiError";
import { json } from "../journey/journey.utils";
import { importSessions } from "../imports/importSession.service";
import type { PendingRef, ScrapedAccount, ScrapedTransaction, ScrapeResult, SyncOutcomeItem, SyncStatus } from "../../types/connections.types";
import { openCredentials } from "./credentialsCipher";
import { providerInfo, type ProviderInfo } from "./providers";
import { addDays, bankWorkbook, cardWorkbook, freshTransactions, israelDay, purchaseDay } from "./scrapeWorkbook";
import { createLibraryScraper, type ScraperFactory } from "./scraperAdapter";

const FIRST_SYNC_DAYS = 90;
const APPROVAL_WAIT_MS = 180_000;
const PAGE_WAIT_MS = 60_000;
const FAILURE_SHOTS = path.resolve(__dirname, "../../../storage/connection-failures");

const active = new Set<number>();

type ConnectionRow = NonNullable<Awaited<ReturnType<typeof prisma.financialConnection.findFirst>>>;

function failureMessage(provider: ProviderInfo, errorType: string | undefined): string {
  const approval = provider.approvalHint
    ? " אם הבנק ביקש אישור באפליקציה, ייתכן שלא אושר בזמן או שהמסך שהופיע עדיין לא נתמך בחיבור. אפשר להמשיך להעלות דף חשבון כקובץ."
    : "";
  switch (errorType) {
    case "INVALID_PASSWORD": return "שם המשתמש או הסיסמה שגויים. לא ננסה שוב אוטומטית, כדי שהחשבון באתר לא יינעל.";
    case "CHANGE_PASSWORD": return `האתר של ${provider.name} מבקש להחליף סיסמה. יש להחליף אותה באתר ואז לעדכן אותה כאן.`;
    case "ACCOUNT_BLOCKED": return `החשבון באתר של ${provider.name} חסום. יש לפנות אליהם.`;
    case "TWO_FACTOR_RETRIEVER_MISSING": return `האתר של ${provider.name} מבקש קוד אימות, ותהליך כזה עדיין לא נתמך בחיבור. אפשר להמשיך להעלות קבצים.`;
    case "TIMEOUT": return `האתר של ${provider.name} לא סיים את הכניסה בזמן.${approval}`;
    default: return `הכניסה או קריאת הנתונים מ־${provider.name} נכשלו — ייתכן שהאתר השתנה.${approval}`;
  }
}

function lastDigits(accountNumber: string): string {
  return accountNumber.replace(/\D/g, "").slice(-4);
}

async function finish(syncId: number, status: SyncStatus, message: string | null, outcome: SyncOutcomeItem[] = [], errorType: string | null = null) {
  await prisma.connectionSync.updateMany({
    where: { id: syncId },
    data: { status, message: message?.slice(0, 500) ?? null, errorType, outcome: json(outcome), finishedAt: new Date() },
  });
}

/**
 * Watermarks: rows on or before a day are already stored. A sync's own rows get
 * an overlap (a card row can post days after its purchase) because the same
 * wording comes back and duplicate review matches it exactly. Rows imported from
 * a file get none — the website words them differently, so an overlap would add them twice.
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
const firstSyncDay = () => addDays(israelDay(new Date().toISOString()), -FIRST_SYNC_DAYS);
const later = (a: string | null, b: string | null) => (a === null ? b : b === null || a > b ? a : b);

function watermark(fromSync: Date | null, fromFiles: Date | null, overlap: number): string | null {
  const synced = day(fromSync);
  return later(synced === null ? null : addDays(synced, -overlap), day(fromFiles));
}

const syncedFile = { startsWith: SYNC_FILE_PREFIX };

async function bankTarget(accountId: number, label: string): Promise<Target> {
  const [synced, files] = await Promise.all([
    prisma.bankTransaction.aggregate({ where: { bankAccountId: accountId, statementImport: { is: { fileName: syncedFile } } }, _max: { transactionDate: true } }),
    prisma.bankTransaction.aggregate({ where: { bankAccountId: accountId, OR: [{ statementImportId: null }, { statementImport: { is: { fileName: { not: syncedFile } } } }] }, _max: { transactionDate: true } }),
  ]);
  return { key: `bank:${accountId}`, label, storedThrough: watermark(synced._max.transactionDate, files._max.transactionDate, OVERLAP_DAYS.bank), chargedThrough: null, filesThrough: day(files._max.transactionDate), filesChargedThrough: null, answers: { kind: "bank", accountId } };
}

async function cardTarget(cardId: number, label: string): Promise<Target> {
  const [synced, files] = await Promise.all([
    prisma.creditTransaction.aggregate({ where: { cardId, creditImport: { fileName: syncedFile } }, _max: { transactionDate: true, chargeDate: true } }),
    prisma.creditTransaction.aggregate({ where: { cardId, creditImport: { fileName: { not: syncedFile } } }, _max: { transactionDate: true, chargeDate: true } }),
  ]);
  return {
    key: `card:${cardId}`, label,
    storedThrough: watermark(synced._max.transactionDate, files._max.transactionDate, OVERLAP_DAYS.card),
    chargedThrough: watermark(synced._max.chargeDate, files._max.chargeDate, OVERLAP_DAYS.card),
    filesThrough: day(files._max.transactionDate), filesChargedThrough: day(files._max.chargeDate),
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
  return (t) => purchaseDay(t) > after || (!!t.installments && t.installments.number > 1 && israelDay(t.processedDate) > chargeAfter);
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

async function importTarget(userId: number, connectionId: number, provider: ProviderInfo, target: Target, txns: ScrapedTransaction[], carried: PendingRef[]): Promise<SyncOutcomeItem> {
  const fresh = freshTransactions(txns, isNewFor(target, carried));
  const workbook = target.answers?.kind === "credit" || !target.answers && provider.kind === "card" ? cardWorkbook(fresh) : bankWorkbook(fresh);
  const base = { key: target.key, target: target.label, rows: workbook.rows, skippedPending: workbook.skippedPending, skippedForeign: workbook.skippedForeign, skippedZero: workbook.skippedZero, storedThrough: target.storedThrough, pending: workbook.pending };
  if (!target.answers) return { ...base, importSessionId: null, note: `${target.label} לא מוגדר במערכת. יש להוסיף אותו במסך הכרטיסים ולרענן שוב — התנועות שלו יילקחו אז.` };
  await cancelUnapproved(userId, connectionId, target.key);
  if (!workbook.rows) return { ...base, importSessionId: null, note: "אין תנועות חדשות" };
  const fileName = `${SYNC_FILE_PREFIX}${provider.name} ${target.label} ${israelDay(new Date().toISOString())}.xlsx`;
  const session = await importSessions.create(userId, fileName, workbook.buffer, target.answers);
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

async function run(userId: number, connection: ConnectionRow, syncId: number, factory: ScraperFactory): Promise<void> {
  const provider = providerInfo(connection.provider);
  if (!provider) return finish(syncId, "failed", "ספק החיבור אינו נתמך");
  // Chained so a late progress write can never overwrite the final status.
  let progress: Promise<unknown> = Promise.resolve();
  try {
    const credentials = openCredentials(userId, connection.credentials);
    if (provider.kind === "bank" && !connection.bankAccountId) throw ApiError.badRequest("יש לבחור לאיזה חשבון בנק במערכת נכנסות התנועות");
    const cards = provider.kind === "card" ? await prisma.creditCard.findMany({ where: { userId }, select: { id: true, lastFour: true } }) : [];
    const known = provider.kind === "bank"
      ? [await bankTarget(connection.bankAccountId!, "חשבון הבנק")]
      : await Promise.all(cards.map((c) => cardTarget(c.id, `כרטיס ${c.lastFour}`)));
    const carried = await carriedPending(connection.id);
    await mkdir(FAILURE_SHOTS, { recursive: true });
    const scraper = await factory({
      companyId: provider.id,
      startDate: scrapeFrom(known, carried),
      defaultTimeout: provider.approvalHint ? APPROVAL_WAIT_MS : PAGE_WAIT_MS,
      storeFailureScreenShotPath: path.join(FAILURE_SHOTS, `connection-${connection.id}-sync-${syncId}.png`),
    });
    scraper.onProgress((type) => {
      // LOGGING_IN fires once the form is submitted: from here the bank may be waiting on her phone.
      const status: SyncStatus | null = type === "LOGGING_IN" && provider.approvalHint ? "awaiting_approval" : type === "LOGIN_SUCCESS" ? "running" : null;
      if (status) progress = progress.then(() => prisma.connectionSync.update({ where: { id: syncId }, data: { status } })).catch((error: unknown) => console.error("[סנכרון] עדכון מצב נכשל", error));
    });
    const result = await scraper.scrape(credentials);
    await progress;
    if (!result.success) {
      console.warn(`[סנכרון] ${provider.name}: נכשל (${result.errorType ?? "לא ידוע"}) — צילום מסך נשמר ב־storage/connection-failures אם הדפדפן הספיק לעלות`);
      return finish(syncId, "failed", failureMessage(provider, result.errorType), [], result.errorType ?? "GENERAL_ERROR");
    }
    await prisma.financialConnection.update({ where: { id: connection.id }, data: { verifiedAt: connection.verifiedAt ?? new Date() } });
    const accounts = validAccounts(result);
    const outcome: SyncOutcomeItem[] = [];
    if (provider.kind === "bank") {
      outcome.push(await importTarget(userId, connection.id, provider, known[0], pickBankAccount(connection, accounts).txns, carried.get(known[0].key) ?? []));
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
    console.log(`[סנכרון] ${provider.name}: ${outcome.map((o) => `${o.target} — ${o.rows} תנועות חדשות, ${o.skippedPending} בהמתנה, ${o.skippedForeign} במטבע זר, ${o.skippedZero} בסכום 0`).join(" · ") || "לא נמצאו חשבונות"}`);
    await finish(syncId, "succeeded", ready ? `${ready} דוחות מחכים לאישור במסך הייבוא` : "לא נמצאו תנועות חדשות לאישור", outcome);
  } catch (error) {
    await progress;
    const message = error instanceof ApiError ? error.message : failureMessage(provider, undefined);
    console.error(`[סנכרון] ${provider.name}: שגיאה`, error instanceof Error ? error.message : error);
    await finish(syncId, "failed", message, [], error instanceof ApiError ? "APP" : "GENERAL_ERROR");
  }
}

export const connectionSync = {
  /** Starts one connection's sync in the background. A failure is recorded on its own sync row only. */
  async start(userId: number, connectionId: number, factory: ScraperFactory = createLibraryScraper) {
    const connection = await prisma.financialConnection.findFirst({ where: { id: connectionId, userId } });
    if (!connection) throw ApiError.notFound("החיבור לא נמצא");
    const running = await prisma.connectionSync.findFirst({ where: { connectionId, status: { in: ["running", "awaiting_approval"] } } });
    if (running || active.has(connectionId)) throw ApiError.conflict("הסנכרון של החיבור הזה כבר רץ");
    active.add(connectionId);
    const sync = await prisma.connectionSync.create({ data: { connectionId, userId, status: "running" } });
    const done = run(userId, connection, sync.id, factory)
      .catch((error: unknown) => console.error("[סנכרון] כשל לא צפוי", error))
      .finally(() => active.delete(connectionId));
    return { sync, done };
  },

  /** A server restart kills the browser mid-login; its sync must not look alive forever. */
  async failInterrupted() {
    const { count } = await prisma.connectionSync.updateMany({
      where: { status: { in: ["running", "awaiting_approval"] } },
      data: { status: "failed", message: "השרת הופעל מחדש באמצע הסנכרון. אפשר לנסות שוב.", finishedAt: new Date() },
    });
    if (count) console.warn(`[סנכרון] ${count} סנכרונים שנקטעו סומנו ככושלים`);
  },
};
