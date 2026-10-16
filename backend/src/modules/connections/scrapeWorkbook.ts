import * as XLSX from "xlsx";
import type { ScrapedTransaction } from "../../types/connections.types";

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
}

const ISRAEL_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" });

/** The scraper's ISO timestamps are Israeli midnight in UTC — the 1st arrives as the 31st 21:00Z. */
export function israelDay(iso: string): string {
  return ISRAEL_DAY.format(new Date(iso));
}

function chargedInShekels(txn: ScrapedTransaction): boolean {
  return txn.chargedCurrency === undefined || ["ILS", "₪", "NIS"].includes(txn.chargedCurrency);
}

function toBuffer(header: string[], rows: Array<Array<string | number>>): Buffer {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([header, ...rows]), "תנועות");
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

// Pending rows can still change or vanish before they post; the next sync brings them settled.
function settled(txns: ScrapedTransaction[]) {
  const kept: ScrapedTransaction[] = [];
  let skippedPending = 0;
  let skippedForeign = 0;
  for (const txn of txns) {
    if (txn.status === "pending") skippedPending += 1;
    else if (!chargedInShekels(txn)) skippedForeign += 1;
    else if (txn.chargedAmount !== 0) kept.push(txn);
  }
  return { kept, skippedPending, skippedForeign };
}

/** Debit/credit comes from the sign the bank charged (its own column), never from the text (§5). */
export function bankWorkbook(txns: ScrapedTransaction[]): ScrapeWorkbook {
  const { kept, skippedPending, skippedForeign } = settled(txns);
  const rows = kept.map((t) => [
    israelDay(t.date),
    t.description.trim(),
    t.chargedAmount < 0 ? -t.chargedAmount : "",
    t.chargedAmount > 0 ? t.chargedAmount : "",
  ]);
  return { buffer: toBuffer(["תאריך", "תיאור", "חובה", "זכות"], rows), rows: rows.length, skippedPending, skippedForeign };
}

/**
 * Card files carry a charge as a positive amount and a refund as negative, the
 * reverse of the scraper's sign. The transaction date drives the month and the
 * processed date is the charge date (§5); instalments keep "n מתוך N".
 */
export function cardWorkbook(txns: ScrapedTransaction[]): ScrapeWorkbook {
  const { kept, skippedPending, skippedForeign } = settled(txns);
  const rows = kept.map((t) => [
    israelDay(t.date),
    israelDay(t.processedDate),
    t.description.trim(),
    -t.chargedAmount,
    t.installments ? `${t.installments.number} מתוך ${t.installments.total}` : 1,
    t.type === "installments" ? "תשלומים" : "רגילה",
  ]);
  return {
    buffer: toBuffer(["תאריך עסקה", "מועד חיוב", "שם בית עסק", "סכום חיוב", "מספר תשלום", "סוג עסקה"], rows),
    rows: rows.length, skippedPending, skippedForeign,
  };
}
