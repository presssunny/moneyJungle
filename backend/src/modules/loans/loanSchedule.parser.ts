import * as XLSX from "xlsx";
import { round2 } from "../../utils/money.utils";

/**
 * The bank's amortisation table (לוח סילוקין) — source of truth for a loan's
 * TERMS, never for its events: an early repayment is invisible here.
 *
 * Two enforced properties: the principal column sums to the balance to the agora
 * (a file that fails is rejected), and one rate satisfies every row.
 */

/** Header labels, in the order the bank prints them. Matched loosely on words. */
const COLUMN_PATTERNS: Array<{ key: ColumnKey; pattern: RegExp }> = [
  { key: "paymentNumber", pattern: /מספר\s*תשלום/ },
  { key: "paymentDate", pattern: /תאריך\s*תשלום/ },
  { key: "principal", pattern: /סכום\s*תשלום\s*קרן/ },
  { key: "interest", pattern: /סכום\s*תשלום\s*ריבית/ },
  { key: "total", pattern: /סה["״']?כ\s*לתשלום/ },
  { key: "balanceAfter", pattern: /יתרה\s*לאחר/ },
];

type ColumnKey = "paymentNumber" | "paymentDate" | "principal" | "interest" | "total" | "balanceAfter";

export interface ScheduleRow {
  paymentNumber: number;
  /** ISO date (YYYY-MM-DD). */
  paymentDate: string;
  principal: number;
  interest: number;
  total: number;
  balanceAfter: number;
}

export interface ParsedSchedule {
  /** Bank loan number ("108") — the key that groups tracks together. */
  loanNumber: string | null;
  /** Track/product code ("432" / "562"). */
  trackNumber: string | null;
  /** Track name as printed ("הל.קהלי מטרה"). */
  trackName: string | null;
  accountNumber: string | null;
  /** When the bank generated the file — a newer export supersedes an older one. */
  exportedAt: string | null;

  rows: ScheduleRow[];

  /** Outstanding principal before the first payment listed. Straight from the file. */
  currentBalance: number;
  /** Regular instalment (the modal `total`; the final row is usually a few ₪ more). */
  monthlyPayment: number;
  annualInterestRate: number;
  /** Total payments in the loan's life = last payment number. */
  totalPayments: number;
  /** Payments already made = first listed payment number − 1. */
  paymentsMade: number;
  paymentsRemaining: number;
  nextPaymentDate: string;
  expectedEndDate: string;
  /** Interest still to be paid across the remaining schedule. */
  remainingInterest: number;

  /**
   * Opening principal. Usually RECONSTRUCTED backwards, because the bank prints
   * only what is left — a scenario, not a measurement. `originalAmountSource`
   * says which, and the UI must mark a reconstructed value (IA §1.2).
   */
  originalAmount: number;
  originalAmountSource: "contract" | "reconstructed";
  /** Principal already repaid. Scenario whenever `originalAmount` is. */
  principalPaid: number;
  interestPaid: number;
  progressPercent: number;

  /** Diagnostics shown to the user so the import is explainable, not magic. */
  checks: {
    principalSumMatchesBalance: boolean;
    principalSum: number;
    rateSpreadPpm: number;
  };
}

export class ScheduleParseError extends Error {}

const num = (value: unknown): number => {
  const text = String(value ?? "").replace(/[,\s₪]/g, "");
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : NaN;
};

/** The bank prints DD.MM.YYYY; also accept DD/MM/YYYY. */
function parseScheduleDate(value: unknown): string | null {
  const match = String(value ?? "")
    .trim()
    .match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (!match) return null;
  const [, day, month, year] = match;
  return `${year}-${month!.padStart(2, "0")}-${day!.padStart(2, "0")}`;
}

function firstMatch(text: string, pattern: RegExp): string | null {
  const match = text.match(pattern);
  return match?.[1]?.trim() ?? null;
}

/**
 * Read the sheet into rows + header facts. Columns are located by their printed
 * labels rather than by position, so a bank that adds or reorders a column does
 * not silently shift every amount by one.
 */
function readSheet(buffer: Buffer): {
  header: string[];
  grid: unknown[][];
  columns: Record<ColumnKey, number>;
  headerRowIndex: number;
} {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: "buffer" });
  } catch {
    throw new ScheduleParseError("לא הצלחנו לפתוח את הקובץ — נדרש קובץ אקסל של לוח סילוקין");
  }
  const sheetName = workbook.SheetNames[0];
  const sheet = sheetName ? workbook.Sheets[sheetName] : undefined;
  if (!sheet) throw new ScheduleParseError("הקובץ ריק");

  const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: "" });

  let headerRowIndex = -1;
  const columns: Record<string, number> = {};
  for (let i = 0; i < Math.min(grid.length, 40); i += 1) {
    const row = grid[i] ?? [];
    const found: Record<string, number> = {};
    row.forEach((cell, index) => {
      const text = String(cell ?? "").trim();
      if (!text) return;
      for (const { key, pattern } of COLUMN_PATTERNS) {
        if (found[key] === undefined && pattern.test(text)) found[key] = index;
      }
    });
    // A real header row carries the whole set, not one stray word.
    if (Object.keys(found).length >= 5) {
      headerRowIndex = i;
      Object.assign(columns, found);
      break;
    }
  }

  if (headerRowIndex === -1) {
    throw new ScheduleParseError(
      "לא זוהו העמודות של לוח סילוקין (מספר תשלום קרן · תאריך תשלום · קרן · ריבית · סה\"כ · יתרה)"
    );
  }

  const header = grid
    .slice(0, headerRowIndex)
    .map((row) => row.map((cell) => String(cell ?? "").trim()).filter(Boolean).join(" "))
    .filter(Boolean);

  return { header, grid, columns: columns as Record<ColumnKey, number>, headerRowIndex };
}

export function parseLoanSchedule(buffer: Buffer): ParsedSchedule {
  const { header, grid, columns, headerRowIndex } = readSheet(buffer);
  const headerText = header.join(" | ");

  const loanNumber = firstMatch(headerText, /מספר\s*הלוו?אה[:\s]+(\d+)/);
  const trackNumber = firstMatch(headerText, /סוג\s*הלוו?אה[:\s]+(\d+)/);
  const accountNumber = firstMatch(headerText, /חשבון[:\s]+([\d-]+)/);
  const exportedAt = firstMatch(headerText, /תאריך[:\s]+(\d{1,2}\/\d{1,2}\/\d{4})/);
  // The product name ("הל.קהלי מטרה") is printed on its own line directly under
  // the track code. Anchoring to that line matters: picking the first
  // colon-less Hebrew line instead would return the sheet title "לוח סילוקין".
  const trackCodeLine = header.findIndex((line) => /סוג\s*הלוו?אה[:\s]/.test(line));
  const trackName =
    trackCodeLine === -1
      ? null
      : (header.slice(trackCodeLine + 1).find((line) => line.length > 0 && !line.includes(":")) ?? null);

  const rows: ScheduleRow[] = [];
  for (let i = headerRowIndex + 1; i < grid.length; i += 1) {
    const raw = grid[i] ?? [];
    const paymentDate = parseScheduleDate(raw[columns.paymentDate]);
    const paymentNumber = num(raw[columns.paymentNumber]);
    if (paymentDate === null || !Number.isFinite(paymentNumber)) continue; // spacer / footer row

    const principal = num(raw[columns.principal]);
    const interest = num(raw[columns.interest]);
    const balanceAfter = num(raw[columns.balanceAfter]);
    const totalRaw = num(raw[columns.total]);
    if (![principal, interest, balanceAfter].every(Number.isFinite)) continue;

    rows.push({
      paymentNumber,
      paymentDate,
      principal: round2(principal),
      interest: round2(interest),
      total: round2(Number.isFinite(totalRaw) ? totalRaw : principal + interest),
      balanceAfter: round2(balanceAfter),
    });
  }

  if (rows.length === 0) throw new ScheduleParseError("לא נמצאו שורות תשלום בקובץ");
  rows.sort((a, b) => a.paymentNumber - b.paymentNumber);

  const first = rows[0]!;
  const last = rows[rows.length - 1]!;
  const currentBalance = round2(first.balanceAfter + first.principal);

  // --- Self-check: the principal column must add up to the opening balance ---
  const principalSum = round2(rows.reduce((sum, row) => sum + row.principal, 0));
  const principalSumMatchesBalance = Math.abs(principalSum - currentBalance) <= 0.05;
  if (!principalSumMatchesBalance) {
    throw new ScheduleParseError(
      `הלוח לא מסתדר: סכום הקרן בשורות (${principalSum.toLocaleString("he-IL")}) שונה מהיתרה ` +
        `(${currentBalance.toLocaleString("he-IL")}). ייתכן שהקובץ חלקי או שנקראו עמודות שגויות.`
    );
  }

  // --- Recover the rate from the rows themselves ---
  const rates: number[] = [];
  let balance = currentBalance;
  for (const row of rows) {
    if (balance > 0) rates.push(row.interest / balance);
    balance = row.balanceAfter;
  }
  const monthlyRate = rates.length > 0 ? rates.reduce((a, b) => a + b, 0) / rates.length : 0;
  const rateSpreadPpm =
    rates.length > 1 ? round2((Math.max(...rates) - Math.min(...rates)) * 1e6) : 0;
  const annualInterestRate = round2(monthlyRate * 1200);

  // The last instalment is usually a few shekels larger (it clears the rounding),
  // so the regular payment is taken from the first row, not from an average.
  const monthlyPayment = first.total;

  // --- Reconstruct what was already paid ---
  // Walking the Spitzer recursion backwards: balance_{k-1} = (balance_k + M) / (1+r).
  // Exact in theory, but it compounds the rounding in `r`, so the result is a
  // SCENARIO — never presented as a measured figure.
  const paymentsMade = Math.max(first.paymentNumber - 1, 0);
  let opening = currentBalance;
  let principalPaid = 0;
  let interestPaid = 0;
  for (let k = 0; k < paymentsMade; k += 1) {
    const previous = monthlyRate > 0 ? (opening + monthlyPayment) / (1 + monthlyRate) : opening + monthlyPayment;
    principalPaid += previous - opening;
    interestPaid += monthlyPayment - (previous - opening);
    opening = previous;
  }

  const originalAmount = round2(opening);
  const remainingInterest = round2(rows.reduce((sum, row) => sum + row.interest, 0));

  return {
    loanNumber,
    trackNumber,
    trackName,
    accountNumber,
    exportedAt: exportedAt ? parseScheduleDate(exportedAt) : null,
    rows,
    currentBalance,
    monthlyPayment,
    annualInterestRate,
    totalPayments: last.paymentNumber,
    paymentsMade,
    paymentsRemaining: rows.length,
    nextPaymentDate: first.paymentDate,
    expectedEndDate: last.paymentDate,
    remainingInterest,
    originalAmount,
    // Only a schedule that starts at payment #1 states the opening principal.
    originalAmountSource: paymentsMade === 0 ? "contract" : "reconstructed",
    principalPaid: round2(principalPaid),
    interestPaid: round2(interestPaid),
    progressPercent: originalAmount > 0 ? round2((principalPaid / originalAmount) * 100) : 0,
    checks: { principalSumMatchesBalance, principalSum, rateSpreadPpm },
  };
}
