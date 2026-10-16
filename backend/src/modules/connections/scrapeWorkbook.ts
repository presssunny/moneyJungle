import * as XLSX from "xlsx";
import type { PendingRef, ScrapedTransaction } from "../../types/connections.types";

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
}

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

function toBuffer(header: string[], rows: Array<Array<string | number>>): Buffer {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([header, ...rows]), "תנועות");
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

// Pending rows can still change or vanish before they post; they are carried, not imported.
function settled(txns: ScrapedTransaction[], shekelWhenUnstated: boolean) {
  const kept: ScrapedTransaction[] = [];
  const pending: PendingRef[] = [];
  let skippedForeign = 0;
  let skippedZero = 0;
  for (const txn of txns) {
    const shekel = txn.chargedCurrency === undefined ? shekelWhenUnstated : SHEKEL.includes(txn.chargedCurrency);
    if (txn.status === "pending") pending.push({ date: israelDay(txn.date), description: txn.description.trim(), amount: txn.chargedAmount });
    else if (!shekel) skippedForeign += 1;
    else if (txn.chargedAmount === 0) skippedZero += 1;
    else kept.push(txn);
  }
  return { kept, pending, skippedPending: pending.length, skippedForeign, skippedZero };
}

/**
 * Debit/credit comes from the sign the bank charged (its own column), never
 * from the text (§5). A bank account has one currency, so an unstated one is shekels.
 */
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
 * Max leaves an unknown billing currency unstated — that is not shekels.
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
