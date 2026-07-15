import * as XLSX from "xlsx";
import { ApiError } from "../../utils/ApiError";
import { round2 } from "../../utils/money.utils";

export interface ParsedExpenseRow {
  name: string;
  amount: number;
  paymentMethodText: string | null;
  date: Date | null;
  categoryText: string | null;
}

type Cell = string | number | Date | boolean | null | undefined;

/** Header keywords → column role. Matched case-insensitively, substring. */
const HEADER_MATCHERS: Array<{ role: "name" | "amount" | "method" | "date" | "category"; keywords: string[] }> = [
  { role: "name", keywords: ["שם", "תיאור", "פירוט", "הוצאה"] },
  { role: "amount", keywords: ["סכום"] },
  { role: "method", keywords: ["אמצעי תשלום", "אמצעי", "תשלום"] },
  { role: "date", keywords: ["תאריך"] },
  { role: "category", keywords: ["קטגוריה"] },
];

function findHeaderRow(rows: Cell[][]): { rowIndex: number; columns: Partial<Record<string, number>> } | null {
  for (let rowIndex = 0; rowIndex < Math.min(rows.length, 30); rowIndex += 1) {
    const row = rows[rowIndex] ?? [];
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
    if (columns.name !== undefined && columns.amount !== undefined) {
      return { rowIndex, columns };
    }
  }
  return null;
}

function parseAmount(value: Cell): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? round2(Math.abs(value)) : null;
  if (typeof value === "string") {
    const cleaned = value.replace(/[₪,\s]/g, "").replace(/[^\d.-]/g, "");
    if (!cleaned) return null;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) && parsed !== 0 ? round2(Math.abs(parsed)) : null;
  }
  return null;
}

function parseCellDate(value: Cell): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return null;
    return new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d));
  }
  if (typeof value === "string") {
    const text = value.trim();
    // ISO first: YYYY-MM-DD (or YYYY/MM/DD)
    const iso = /^(\d{4})[./-](\d{1,2})[./-](\d{1,2})/.exec(text);
    if (iso) {
      return new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
    }
    // Israeli day-first: DD/MM/YYYY (or DD.MM.YY)
    const dmy = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/.exec(text);
    if (dmy) {
      let year = Number(dmy[3]);
      if (year < 100) year += 2000;
      return new Date(Date.UTC(year, Number(dmy[2]) - 1, Number(dmy[1])));
    }
    return null;
  }
  return null;
}

/**
 * Parse a monthly-plan Excel file like the family's spreadsheet:
 * a header row with שם / סכום / אמצעי תשלום, then one row per expense.
 * Rows without a positive amount (section titles, empty rows) are skipped.
 */
export function parseExpensesFile(buffer: Buffer): ParsedExpenseRow[] {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  } catch {
    throw ApiError.badRequest("הקובץ אינו קובץ אקסל תקין");
  }

  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw ApiError.badRequest("הקובץ ריק — לא נמצא גיליון");

  const rows: Cell[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
  const header = findHeaderRow(rows);
  if (!header) {
    throw ApiError.badRequest('לא נמצאה שורת כותרות עם "שם" ו"סכום" — בדקי את מבנה הקובץ');
  }

  const parsed: ParsedExpenseRow[] = [];
  for (let i = header.rowIndex + 1; i < rows.length; i += 1) {
    const row = rows[i] ?? [];
    const name = String(row[header.columns.name!] ?? "").trim();
    const amount = parseAmount(row[header.columns.amount!]);
    if (!name || amount === null) continue;
    parsed.push({
      name,
      amount,
      paymentMethodText:
        header.columns.method !== undefined ? String(row[header.columns.method] ?? "").trim() || null : null,
      date: header.columns.date !== undefined ? parseCellDate(row[header.columns.date]) : null,
      categoryText:
        header.columns.category !== undefined ? String(row[header.columns.category] ?? "").trim() || null : null,
    });
  }

  if (parsed.length === 0) throw ApiError.badRequest("לא נמצאו שורות הוצאה תקינות בקובץ");
  return parsed;
}
