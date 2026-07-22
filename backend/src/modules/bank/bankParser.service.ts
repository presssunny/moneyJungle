import * as XLSX from "xlsx";
import { ApiError } from "../../utils/ApiError";
import { round2 } from "../../utils/money.utils";

export type BankTransactionKind = "deposit" | "withdrawal";

export interface ParsedBankRow {
  date: Date;
  description: string;
  amount: number; // always positive
  type: BankTransactionKind;
  raw: Record<string, unknown>;
}

type Cell = string | number | Date | boolean | null | undefined;
type Role = "date" | "description" | "debit" | "credit" | "amount" | "balance";

/**
 * Header keywords → column role for an Israeli current-account (עו״ש) statement.
 * Matched case-insensitively, substring. Bank exports vary: some split money-out
 * (חובה) and money-in (זכות) into two columns; others use one signed סכום column.
 * We detect whichever layout is present. "balance" (יתרה) is only detected so its
 * column isn't mistaken for the amount.
 */
const HEADER_MATCHERS: Array<{ role: Role; keywords: string[] }> = [
  { role: "date", keywords: ["תאריך", "ת. ערך", "תאריך ערך"] },
  { role: "description", keywords: ["תיאור", "פירוט", "תנועה", "פעולה", "סוג פעולה", "שם"] },
  { role: "debit", keywords: ["חובה", "בחובה", "משיכה", "חיוב"] },
  { role: "credit", keywords: ["זכות", "בזכות", "הפקדה", "זיכוי"] },
  { role: "balance", keywords: ["יתרה"] },
  { role: "amount", keywords: ["סכום"] },
];

function findHeaderRow(rows: Cell[][]): { rowIndex: number; columns: Partial<Record<Role, number>> } | null {
  for (let rowIndex = 0; rowIndex < Math.min(rows.length, 30); rowIndex += 1) {
    const row = rows[rowIndex] ?? [];
    const columns: Partial<Record<Role, number>> = {};
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
    // A statement is recognizable once it has a date column plus a way to read
    // the money moved: either split debit/credit, or a single amount column.
    const hasMoney = columns.debit !== undefined || columns.credit !== undefined || columns.amount !== undefined;
    if (columns.date !== undefined && hasMoney) {
      return { rowIndex, columns };
    }
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
    const iso = /^(\d{4})[./-](\d{1,2})[./-](\d{1,2})/.exec(text);
    if (iso) return new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
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

/** Parse a money cell, keeping the sign. Returns null for blank/non-numeric. */
function parseSignedAmount(value: Cell): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? round2(value) : null;
  if (typeof value === "string") {
    const cleaned = value.replace(/[₪,\s]/g, "").replace(/−/g, "-").replace(/[^\d.-]/g, "");
    if (!cleaned || cleaned === "-" || cleaned === ".") return null;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? round2(parsed) : null;
  }
  return null;
}

/** Summary/footer rows that must not become transactions. */
const SUMMARY_ROW_PATTERNS = [/סה["״']?כ/, /^סך/, /^total/i, /יתרת פתיחה/, /יתרת סגירה/, /יתרה קודמת/];

function isSummaryRow(text: string): boolean {
  return SUMMARY_ROW_PATTERNS.some((pattern) => pattern.test(text.trim()));
}

/**
 * Parse an Israeli current-account (עו״ש) statement into transactions.
 * Money-in becomes a "deposit", money-out a "withdrawal" — so a single file
 * feeds both the income and expense sides of the account.
 */
export function parseBankStatement(buffer: Buffer): ParsedBankRow[] {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  } catch {
    throw ApiError.badRequest("הקובץ אינו קובץ אקסל תקין");
  }

  const parsed: ParsedBankRow[] = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const rows = XLSX.utils.sheet_to_json<Cell[]>(sheet, { header: 1, defval: null });
    const header = findHeaderRow(rows);
    if (!header) continue;
    const cols = header.columns;

    for (let i = header.rowIndex + 1; i < rows.length; i += 1) {
      const row = rows[i] ?? [];
      if (row.every((cell) => cell === null || String(cell).trim() === "")) continue;

      const date = parseCellDate(row[cols.date!]);
      if (!date) continue;
      const description = String(row[cols.description ?? cols.date!] ?? "").trim() || "תנועה בחשבון";
      if (isSummaryRow(description)) continue;

      let amount: number | null = null;
      let type: BankTransactionKind | null = null;

      if (cols.debit !== undefined || cols.credit !== undefined) {
        const debit = cols.debit !== undefined ? parseSignedAmount(row[cols.debit]) : null;
        const credit = cols.credit !== undefined ? parseSignedAmount(row[cols.credit]) : null;
        if (credit && Math.abs(credit) > 0) {
          amount = Math.abs(credit);
          type = "deposit";
        } else if (debit && Math.abs(debit) > 0) {
          amount = Math.abs(debit);
          type = "withdrawal";
        }
      } else if (cols.amount !== undefined) {
        const signed = parseSignedAmount(row[cols.amount]);
        if (signed && signed !== 0) {
          amount = Math.abs(signed);
          type = signed > 0 ? "deposit" : "withdrawal";
        }
      }

      if (amount === null || type === null) continue;

      parsed.push({
        date,
        description,
        amount,
        type,
        raw: Object.fromEntries(row.map((cell, c) => [String(c), cell instanceof Date ? cell.toISOString() : cell])),
      });
    }
  }

  if (parsed.length === 0) {
    throw ApiError.badRequest(
      "לא נמצאו תנועות בקובץ (נדרשות עמודות: תאריך, ותנועה עם חובה/זכות או סכום)"
    );
  }
  return parsed;
}
