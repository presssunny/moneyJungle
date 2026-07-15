import * as XLSX from "xlsx";
import { ApiError } from "../../utils/ApiError";
import { round2 } from "../../utils/money.utils";

export type CreditTransactionType = "regular" | "standing_order" | "credit" | "refund" | "financing";

export interface ParsedCreditRow {
  transactionDate: Date;
  /** מועד חיוב — when the card company actually charges the account (may be null for in-process rows) */
  chargeDate: Date | null;
  businessName: string;
  amount: number;
  paymentCount: number;
  transactionType: CreditTransactionType;
  raw: Record<string, unknown>;
}

type Role = "date" | "business" | "amount" | "payments" | "charge" | "type";

/**
 * Header keywords → column role. Matched case-insensitively, substring.
 * Order within each list matters only for readability; first column that
 * matches a role wins. "charge" must be distinct from "date" (both contain
 * a date), so its keywords avoid the bare word "תאריך".
 */
const HEADER_MATCHERS: Array<{ role: Role; keywords: string[] }> = [
  { role: "charge", keywords: ["מועד חיוב", "מועד החיוב", "תאריך חיוב", "מועד"] },
  { role: "date", keywords: ["תאריך עסקה", "תאריך רכישה", "תאריך ביצוע", "תאריך"] },
  { role: "business", keywords: ["שם בית עסק", "בית עסק", "שם בית העסק", "שם עסק", "תיאור"] },
  { role: "amount", keywords: ["סכום חיוב", "סכום בש", "סכום בשח", "סכום עסקה", "סכום"] },
  { role: "payments", keywords: ["מספר תשלום", "תשלומים", "מספר תשלומים"] },
  { role: "type", keywords: ["סוג עסקה", "סוג העסקה", "סוג"] },
];

type Cell = string | number | Date | boolean | null | undefined;

/**
 * Revolving-credit ("אשראי מתגלגל") lines: the card company credits back last
 * month's rolled balance and re-charges the new one. These are internal
 * financing movements, not real spending, and the statement's own total
 * excludes them — so we tag them "financing" and keep them out of spend totals.
 */
function isRevolvingCredit(businessName: string): boolean {
  return /אשראי מתגלגל|יתרת אשראי/.test(businessName);
}

/** Normalize the Hebrew "סוג עסקה" value (+ business name) into a stable type. */
function normalizeType(raw: string, amount: number, businessName: string): CreditTransactionType {
  if (isRevolvingCredit(businessName)) return "financing";
  const value = raw.trim();
  if (amount < 0 || value.includes("זיכוי") || value.includes("החזר")) return "refund";
  if (value.includes("הוראת קבע") || value.includes('הו"ק')) return "standing_order";
  if (value.includes("קרדיט") || value.includes("תשלומים") || value.includes("קרדיטק")) return "credit";
  return "regular";
}

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
    // Normalize the unicode minus (−) credit companies love, strip currency chrome
    const cleaned = value.replace(/[₪,\s]/g, "").replace(/−/g, "-");
    const amount = Number(cleaned);
    return Number.isFinite(amount) ? round2(amount) : null;
  }
  return null;
}

/** Footer/summary rows that must not become transactions. */
const SUMMARY_ROW_PATTERNS = [/סה["״']?כ/, /^סך/, /^total/i, /עסקאות\s*ש?חויבו/, /יתרה לחיוב/];

function isSummaryRow(businessName: string): boolean {
  return SUMMARY_ROW_PATTERNS.some((pattern) => pattern.test(businessName.trim()));
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

function parseSheet(rows: Cell[][]): ParsedCreditRow[] {
  const header = findHeaderRow(rows);
  if (!header) return [];

  const parsed: ParsedCreditRow[] = [];
  for (let rowIndex = header.rowIndex + 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    if (!row || row.every((cell) => cell === null || String(cell).trim() === "")) continue;

    const transactionDate = parseCellDate(row[header.columns.date!]);
    const businessName = String(row[header.columns.business!] ?? "").trim();
    const amount = parseCellAmount(row[header.columns.amount!]);
    if (!transactionDate || !businessName || amount === null || amount === 0) continue;
    if (isSummaryRow(businessName)) continue;

    const chargeDate =
      header.columns.charge !== undefined ? parseCellDate(row[header.columns.charge]) : null;
    const typeText = header.columns.type !== undefined ? String(row[header.columns.type] ?? "") : "";

    parsed.push({
      transactionDate,
      chargeDate,
      businessName,
      // Sign is kept: negative = זיכוי/refund, so totals come out right
      amount,
      paymentCount:
        header.columns.payments !== undefined ? parseCellPayments(row[header.columns.payments]) : 1,
      transactionType: normalizeType(typeText, amount, businessName),
      raw: Object.fromEntries(row.map((cell, i) => [String(i), cell instanceof Date ? cell.toISOString() : cell])),
    });
  }
  return parsed;
}

/**
 * Parse an Israeli credit-card export (Isracard / Max / Cal / ...) into
 * transaction rows. All sheets are scanned — Max and Cal split domestic and
 * foreign transactions into separate sheets.
 */
export function parseCreditFile(buffer: Buffer): ParsedCreditRow[] {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  } catch {
    throw ApiError.badRequest("הקובץ אינו קובץ אקסל תקין");
  }

  if (workbook.SheetNames.length === 0) throw ApiError.badRequest("הקובץ ריק — לא נמצא גיליון");

  const parsed: ParsedCreditRow[] = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const rows = XLSX.utils.sheet_to_json<Cell[]>(sheet, { header: 1, defval: null });
    parsed.push(...parseSheet(rows));
  }

  if (parsed.length === 0) {
    throw ApiError.badRequest(
      "לא נמצאו עסקאות בקובץ (נדרשות עמודות: תאריך, שם בית עסק, סכום)"
    );
  }
  return parsed;
}
