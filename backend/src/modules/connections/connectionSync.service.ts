import path from "node:path";
import { mkdir } from "node:fs/promises";
import { prisma } from "../../config/database";
import { ApiError } from "../../utils/ApiError";
import { json } from "../journey/journey.utils";
import { importSessions } from "../imports/importSession.service";
import type { ScrapedAccount, ScrapeResult, SyncOutcomeItem, SyncStatus } from "../../types/connections.types";
import { openCredentials } from "./credentialsCipher";
import { providerInfo, type ProviderInfo } from "./providers";
import { bankWorkbook, cardWorkbook, israelDay, type ScrapeWorkbook } from "./scrapeWorkbook";
import { createLibraryScraper, type ScraperFactory } from "./scraperAdapter";

const DAY_MS = 24 * 60 * 60 * 1000;
const FIRST_SYNC_DAYS = 90;
const OVERLAP_DAYS = 7;
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
  await prisma.connectionSync.update({
    where: { id: syncId },
    data: { status, message: message?.slice(0, 500) ?? null, errorType, outcome: json(outcome), finishedAt: new Date() },
  });
}

async function importAccount(userId: number, provider: ProviderInfo, workbook: ScrapeWorkbook, target: string, answers: { kind: "bank"; accountId: number } | { kind: "credit"; cardId: number }): Promise<SyncOutcomeItem> {
  const base = { target, rows: workbook.rows, skippedPending: workbook.skippedPending, skippedForeign: workbook.skippedForeign };
  if (!workbook.rows) return { ...base, importSessionId: null, note: "אין תנועות סגורות בתקופה" };
  const fileName = `סנכרון ${provider.name} ${target} ${israelDay(new Date().toISOString())}.xlsx`;
  const session = await importSessions.create(userId, fileName, workbook.buffer, answers);
  return { ...base, importSessionId: session.id };
}

async function importBank(userId: number, connection: ConnectionRow, provider: ProviderInfo, accounts: ScrapedAccount[]): Promise<SyncOutcomeItem[]> {
  if (!connection.bankAccountId) throw ApiError.badRequest("יש לבחור לאיזה חשבון בנק במערכת נכנסות התנועות");
  const hint = connection.accountHint?.replace(/\D/g, "");
  const matches = hint ? accounts.filter((a) => a.accountNumber.replace(/\D/g, "").endsWith(hint)) : accounts;
  if (matches.length !== 1) {
    const endings = accounts.map((a) => lastDigits(a.accountNumber)).join(", ");
    throw ApiError.badRequest(`בכניסה הזו יש ${accounts.length} חשבונות (מסתיימים ב־${endings}). יש לכתוב בחיבור את ספרות החשבון הרצוי.`);
  }
  const account = matches[0];
  return [await importAccount(userId, provider, bankWorkbook(account.txns), `חשבון ${lastDigits(account.accountNumber)}`, { kind: "bank", accountId: connection.bankAccountId })];
}

async function importCards(userId: number, provider: ProviderInfo, accounts: ScrapedAccount[]): Promise<SyncOutcomeItem[]> {
  const cards = await prisma.creditCard.findMany({ where: { userId }, select: { id: true, lastFour: true } });
  const outcome: SyncOutcomeItem[] = [];
  for (const account of accounts) {
    const digits = lastDigits(account.accountNumber);
    const card = cards.find((c) => c.lastFour === digits);
    const workbook = cardWorkbook(account.txns);
    if (!card) {
      outcome.push({ importSessionId: null, target: `כרטיס ${digits}`, rows: workbook.rows, skippedPending: workbook.skippedPending, skippedForeign: workbook.skippedForeign,
        note: `כרטיס שמסתיים ב־${digits} לא מוגדר במערכת. יש להוסיף אותו במסך הכרטיסים ולסנכרן שוב.` });
      continue;
    }
    outcome.push(await importAccount(userId, provider, workbook, `כרטיס ${digits}`, { kind: "credit", cardId: card.id }));
  }
  return outcome;
}

function validAccounts(result: ScrapeResult): ScrapedAccount[] {
  return (result.accounts ?? []).filter((a) => typeof a.accountNumber === "string" && Array.isArray(a.txns));
}

async function run(userId: number, connection: ConnectionRow, syncId: number, factory: ScraperFactory): Promise<void> {
  const provider = providerInfo(connection.provider);
  if (!provider) return finish(syncId, "failed", "ספק החיבור אינו נתמך");
  try {
    const credentials = openCredentials(userId, connection.credentials);
    const since = connection.lastSyncAt ? connection.lastSyncAt.getTime() - OVERLAP_DAYS * DAY_MS : Date.now() - FIRST_SYNC_DAYS * DAY_MS;
    await mkdir(FAILURE_SHOTS, { recursive: true });
    const scraper = await factory({
      companyId: provider.id,
      startDate: new Date(since),
      defaultTimeout: provider.approvalHint ? APPROVAL_WAIT_MS : PAGE_WAIT_MS,
      storeFailureScreenShotPath: path.join(FAILURE_SHOTS, `connection-${connection.id}-sync-${syncId}.png`),
    });
    // Chained so a late progress write can never overwrite the final status.
    let progress: Promise<unknown> = Promise.resolve();
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
    const outcome = provider.kind === "bank" ? await importBank(userId, connection, provider, accounts) : await importCards(userId, provider, accounts);
    await prisma.financialConnection.update({ where: { id: connection.id }, data: { lastSyncAt: new Date() } });
    const ready = outcome.filter((o) => o.importSessionId).length;
    console.log(`[סנכרון] ${provider.name}: ${outcome.map((o) => `${o.target} — ${o.rows} תנועות, ${o.skippedPending} בהמתנה, ${o.skippedForeign} במטבע זר`).join(" · ") || "לא נמצאו חשבונות"}`);
    await finish(syncId, "succeeded", ready ? `${ready} דוחות מחכים לאישור במסך הייבוא` : "לא נמצאו תנועות חדשות לאישור", outcome);
  } catch (error) {
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
