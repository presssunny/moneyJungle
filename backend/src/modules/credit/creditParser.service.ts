import * as XLSX from "xlsx";
import { ApiError } from "../../utils/ApiError";
import { round2 } from "../../utils/money.utils";

export interface ParsedCreditRow {
  transactionDate: Date;
  businessName: string;
  amount: number;
  paymentCount: number;
  raw: Record<string, unknown>;
}

/** Header keywords → column role. Matched case-insensitively, substring. */
const HEADER_MATCHERS: Array<{ role: "date" | "business" | "amount" | "payments"; keywords: string[] }> = [
  { role: "date", keywords: ["תאריך עסקה", "תאריך רכישה", "תאריך"] },
  { role: "business", keywords: ["שם בית עסק", "בית עסק", "שם בית העסק", "תיאור"] },
  { role: "amount", keywords: ["סכום חיוב", "סכום עסקה", "סכום"] },
  { role: "payments", keywords: ["מספר תשלום", "תשלומים", "תשלום"] },
];

type Cell = string | number | Date | boolean | null | undefined;

function findHeaderRow(rows: Cell[][]): { rowIndex: number; columns: Partial<Record<string, number>> } | null {
  for (let rowIndex = 0; rowIndex < Math.min(rows.length, 30); rowIndex += 1) {
    const row = rows[rowIndex];
    const columns: Partial<Record<string, number>> = {};
    for (let colIndex = 0; colIndex < row.length; colIndex += 1) {
      const cell = String(row[colIndex] ?? "").trim();
      if (!cell) continue;
      for (const matcher of HEADER_MATCHERS) {
        if (columns[matcher.role] !== undefined) continue;
        if (matcher.keywords.some((keyword) => cell.includes(keyword))) {
          columns[matcher.role] = colIndex;
        }
      }
    }
    if (columns.date !== undefined && columns.business !== undefined && columns.amount !== undefined) {
      return { rowIndex, columns };
    }
  }
  return null;
}

function parseCellDate(value: Cell): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === "number") {
    // Excel serial date
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return null;
    return new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d));
  }
  if (typeof value === "string") {
    const match = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/.exec(value.trim());
    if (!match) return null;
    const day = Number(match[1]);
    const month = Number(match[2]);
    let year = Number(match[3]);
    if (year < 100) year += 2000;
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return new Date(Date.UTC(year, month - 1, day));
  }
  return null;
}

function parseCellAmount(value: Cell): number | null {
  if (typeof value === "number") return round2(value);
  if (typeof value === "string") {
    const cleaned = value.replace(/[₪,\s]/g, "").replace(/^-−/, "-");
    const amount = Number(cleaned);
    return Number.isFinite(amount) ? round2(amount) : null;
  }
  return null;
}

function parseCellPayments(value: Cell): number {
  if (typeof value === "number" && Number.isFinite(value) && value >= 1) return Math.floor(value);
  if (typeof value === "string") {
    // Formats like "3", "2 מתוך 6", "1/6"
    const match = /(\d+)\s*(?:מתוך|\/)\s*(\d+)/.exec(value);
    if (match) return Number(match[2]);
    const single = Number(value.trim());
    if (Number.isFinite(single) && single >= 1) return Math.floor(single);
  }
  return 1;
}

/** Parse an Israeli credit-card XLSX export into transaction rows. */
export function parseCreditFile(buffer: Buffer): ParsedCreditRow[] {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  } catch {
    throw ApiError.badRequest("הקובץ אינו קובץ אקסל תקין");
  }

  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw ApiError.badRequest("הקובץ ריק — לא נמצא גיליון");

  const rows = XLSX.utils.sheet_to_json<Cell[]>(sheet, { header: 1, defval: null });
  const header = findHeaderRow(rows);
  if (!header) {
    throw ApiError.badRequest(
      "לא זוהו כותרות בקובץ (נדרשות עמודות: תאריך, שם בית עסק, סכום)"
    );
  }

  const parsed: ParsedCreditRow[] = [];
  for (let rowIndex = header.rowIndex + 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    if (!row || row.every((cell) => cell === null || String(cell).trim() === "")) continue;

    const transactionDate = parseCellDate(row[header.columns.date!]);
    const businessName = String(row[header.columns.business!] ?? "").trim();
    const amount = parseCellAmount(row[header.columns.amount!]);
    if (!transactionDate || !businessName || amount === null || amount === 0) continue;

    parsed.push({
      transactionDate,
      businessName,
      amount: Math.abs(amount),
      paymentCount:
        header.columns.payments !== undefined ? parseCellPayments(row[header.columns.payments]) : 1,
      raw: Object.fromEntries(row.map((cell, i) => [String(i), cell instanceof Date ? cell.toISOString() : cell])),
    });
  }

  if (parsed.length === 0) {
    throw ApiError.badRequest("לא נמצאו עסקאות תקינות בקובץ");
  }
  return parsed;
}
