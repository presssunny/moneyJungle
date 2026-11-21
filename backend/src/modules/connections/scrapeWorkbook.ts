import * as XLSX from "xlsx";
import type { ForeignRef, PendingRef, ScrapedLoan, ScrapedTransaction } from "../../types/connections.types";

/**
 * A sync becomes an ordinary statement file, read by the same parsers as an
 * upload (CLAUDE.md §4: one classifier, one dedupe, one approval screen).
 * The headers below are the ones bankParser/creditParser already recognize.
 */
export interface ScrapeWorkbook {
  buffer: Buffer;
  rows: number;
  skippedPending: number;
  skippedForeign: number;
  skippedZero: number;
  /** Still in process at the bank — carried so the next sync takes them even if older than its window. */
  pending: PendingRef[];
  foreign: ForeignRef[];
}

export const FOREIGN_LIST_CAP = 20;

const ISRAEL_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" });

/** The scraper's ISO timestamps are Israeli midnight in UTC — the 1st arrives as the 31st 21:00Z. */
export function israelDay(iso: string): string {
  return ISRAEL_DAY.format(new Date(iso));
}

export function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function addMonths(day: string, months: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

/**
 * The library moves instalment n forward by n−1 months; card statements (and the
 * rows already stored) keep the purchase date on every instalment. A purchase on
 * the 29th–31st may come back a day or two early — the library clamped it.
 */
export function purchaseDay(txn: ScrapedTransaction): string {
  const shift = txn.installments && txn.installments.number > 1 ? txn.installments.number - 1 : 0;
  return addMonths(israelDay(txn.date), -shift);
}

const SHEKEL = ["ILS", "₪", "NIS"];

/** Pending rows pass through so the workbook can count and carry them. */
export function freshTransactions(txns: ScrapedTransaction[], isNew: (txn: ScrapedTransaction) => boolean): ScrapedTransaction[] {
  return txns.filter((t) => t.status === "pending" || isNew(t));
}

function toBuffer(header: string[], rows: Array<Array<string | number>>, sheet = "תנועות"): Buffer {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([header, ...rows]), sheet);
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

/**
 * A card that leaves the billing currency unstated (Max) billed in shekels only when the purchase
 * itself was in shekels; otherwise it stays out and is listed (banker 2026-10-17). A bank account
 * has one currency, so there an unstated one is shekels.
 */
function chargedInShekels(txn: ScrapedTransaction, isBank: boolean): boolean {
  if (txn.chargedCurrency !== undefined) return SHEKEL.includes(txn.chargedCurrency);
  return isBank || SHEKEL.includes(txn.originalCurrency);
}

// Pending rows can still change or vanish before they post; they are carried, not imported.
function settled(txns: ScrapedTransaction[], isBank: boolean) {
  const kept: ScrapedTransaction[] = [];
  const pending: PendingRef[] = [];
  const foreign: ForeignRef[] = [];
  let skippedForeign = 0;
  let skippedZero = 0;
  for (const txn of txns) {
    if (txn.status === "pending") pending.push({ date: israelDay(txn.date), description: txn.description.trim(), amount: txn.chargedAmount });
    else if (!chargedInShekels(txn, isBank)) {
      skippedForeign += 1;
      if (foreign.length < FOREIGN_LIST_CAP) {
        foreign.push({
          date: isBank ? israelDay(txn.date) : purchaseDay(txn), description: txn.description.trim(),
          originalAmount: txn.originalAmount, originalCurrency: txn.originalCurrency,
          chargedAmount: txn.chargedCurrency === undefined ? null : txn.chargedAmount, chargedCurrency: txn.chargedCurrency ?? null,
        });
      }
    } else if (txn.chargedAmount === 0) skippedZero += 1;
    else kept.push(txn);
  }
  return { kept, pending, foreign, skippedPending: pending.length, skippedForeign, skippedZero };
}

/** Debit/credit comes from the sign the bank charged (its own column), never from the text (§5). */
export function bankWorkbook(txns: ScrapedTransaction[]): ScrapeWorkbook {
  const { kept, ...counts } = settled(txns, true);
  const rows = kept.map((t) => [
    israelDay(t.date),
    t.description.trim(),
    t.chargedAmount < 0 ? -t.chargedAmount : "",
    t.chargedAmount > 0 ? t.chargedAmount : "",
  ]);
  return { buffer: toBuffer(["תאריך", "תיאור", "חובה", "זכות"], rows), rows: rows.length, ...counts };
}

/**
 * Card files carry a charge as a positive amount and a refund as negative, the
 * reverse of the scraper's sign. The purchase date drives the month and the
 * processed date is the charge date (§5); instalments keep "n מתוך N".
 */
export function cardWorkbook(txns: ScrapedTransaction[]): ScrapeWorkbook {
  const { kept, ...counts } = settled(txns, false);
  const rows = kept.map((t) => [
    purchaseDay(t),
    israelDay(t.processedDate),
    t.description.trim(),
    -t.chargedAmount,
    t.installments ? `${t.installments.number} מתוך ${t.installments.total}` : 1,
    t.type === "installments" ? "תשלומים" : "רגילה",
  ]);
  return {
    buffer: toBuffer(["תאריך עסקה", "מועד חיוב", "שם בית עסק", "סכום חיוב", "מספר תשלום", "סוג עסקה"], rows),
    rows: rows.length, ...counts,
  };
}

export type LoanScheduleSkip = "SCHEDULE_INCOMPLETE" | "INDEX_LINKED" | "IDENTIFIER_UNREADABLE" | "NO_SCHEDULE";

const DIGITS = /^\d+$/;

/** A bank day as YYYY-MM-DD: an ISO day or timestamp (Israeli midnight), or the bank's DD.MM.YYYY / DD/MM/YYYY. */
export function bankDay(value: string | null): string | null {
  if (!value) return null;
  const text = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const printed = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(text);
  if (printed) return `${printed[3]}-${printed[2].padStart(2, "0")}-${printed[1].padStart(2, "0")}`;
  return /^\d{4}-\d{2}-\d{2}T/.test(text) && !Number.isNaN(Date.parse(text)) ? israelDay(text) : null;
}

const printedDay = (day: string, separator: string) => day.split("-").reverse().join(separator);

/**
 * A loan track read from the site becomes the same schedule file she would download, so it goes
 * through parseLoanSchedule, the import's approval and its loan matching (CLAUDE.md §7). The date
 * line is the bank's `asOf`, never today: identical figures must give identical bytes (fileHash dedup).
 */
export function loanScheduleWorkbook(loan: ScrapedLoan): ScrapeWorkbook | { skip: LoanScheduleSkip } {
  // The parser reads both identifiers with \d+; anything else would match the wrong loan or none.
  if (!DIGITS.test(loan.loanNumber) || loan.trackNumber === null || !DIGITS.test(loan.trackNumber)) return { skip: "IDENTIFIER_UNREADABLE" };
  if (!loan.schedule.length) return { skip: "NO_SCHEDULE" };
  const days = loan.schedule.map((payment) => bankDay(payment.date));
  if (loan.schedule.some((p, i) => p.principal === null || p.interest === null || p.balanceAfter === null || days[i] === null)) return { skip: "SCHEDULE_INCOMPLETE" };
  // The schedule format has no linkage column, and CPI linkage needs a banker's rule first (§5).
  if (loan.indexLinked === true || loan.schedule.some((p) => p.linkage !== null && p.linkage !== 0)) return { skip: "INDEX_LINKED" };
  const asOf = bankDay(loan.asOf);
  // The parser takes the first colon-less line under the track code as its name.
  const name = loan.name?.replace(/:/g, " ").replace(/\s+/g, " ").trim();
  const header = [`סוג הלוואה: ${loan.trackNumber}`, ...(name ? [name] : []), ...(asOf ? [`תאריך: ${printedDay(asOf, "/")}`] : [])];
  const rows = loan.schedule.map((p, i) => [p.paymentNumber, printedDay(days[i]!, "."), p.principal!, p.interest!, p.total ?? "", p.balanceAfter!]);
  return {
    buffer: toBuffer([`מספר הלוואה: ${loan.loanNumber}`], [
      ...header.map((line) => [line]),
      ["מספר תשלום", "תאריך תשלום", "סכום תשלום קרן", "סכום תשלום ריבית", 'סה"כ לתשלום', "יתרה לאחר תשלום"],
      ...rows,
    ], "לוח סילוקין"),
    rows: rows.length, skippedPending: 0, skippedForeign: 0, skippedZero: 0, pending: [], foreign: [],
  };
}
