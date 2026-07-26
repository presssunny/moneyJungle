import crypto from "crypto";
import * as XLSX from "xlsx";

/**
 * Which kind of statement a user just dropped on the app.
 *
 * The user should not have to know which tab a file belongs to — she has one
 * file and one question ("what is in this?"). This module answers *only* that,
 * from the file's own content; the parsers stay responsible for reading it.
 *
 * Detection reads column headers, never the file name: names are renamed,
 * duplicated and downloaded as "document(3).xlsx", and a wrong guess sends a
 * statement to the wrong parser.
 */
export type StatementKind = "bank" | "credit" | "unknown";

export interface StatementDetection {
  kind: StatementKind;
  /** Hebrew, shown to the user: why the app thinks it is this kind. */
  reason: string;
  /** Header words that decided it — kept so a wrong guess can be explained. */
  matchedSignals: string[];
  bankScore: number;
  creditScore: number;
  /** SHA-256 of the raw bytes: identifies a re-upload of the very same file. */
  fileHash: string;
}

/**
 * Header words that only one kind of statement has.
 *
 * A running balance (יתרה) and a debit/credit column pair belong to an account;
 * a merchant name and a billing date belong to a card. Words both share
 * (תאריך, סכום) carry no weight — they would only add noise.
 */
const BANK_SIGNALS: Array<{ pattern: RegExp; label: string; weight: number }> = [
  { pattern: /יתרה/, label: "יתרה", weight: 3 },
  { pattern: /זכות/, label: "זכות", weight: 3 },
  { pattern: /חובה/, label: "חובה", weight: 3 },
  { pattern: /יתרת\s*פתיחה|יתרה\s*קודמת/, label: "יתרת פתיחה", weight: 3 },
  { pattern: /ת\.\s*ערך|תאריך\s*ערך/, label: "תאריך ערך", weight: 2 },
  { pattern: /אסמכתא/, label: "אסמכתא", weight: 2 },
  { pattern: /סוג\s*פעולה|פעולה/, label: "פעולה", weight: 1 },
];

const CREDIT_SIGNALS: Array<{ pattern: RegExp; label: string; weight: number }> = [
  { pattern: /בית\s*עסק/, label: "שם בית עסק", weight: 3 },
  { pattern: /מועד\s*ה?חיוב|תאריך\s*חיוב/, label: "מועד חיוב", weight: 3 },
  { pattern: /סוג\s*עסקה/, label: "סוג עסקה", weight: 3 },
  { pattern: /מספר\s*שובר/, label: "מספר שובר", weight: 2 },
  { pattern: /תשלומים/, label: "תשלומים", weight: 1 },
  { pattern: /כרטיס/, label: "כרטיס", weight: 1 },
];

/** Header rows live at the top; scanning further only picks up transaction text. */
const HEADER_SCAN_ROWS = 40;

function isPdf(buffer: Buffer, fileName: string): boolean {
  return /\.pdf$/i.test(fileName) || buffer.subarray(0, 5).toString("latin1") === "%PDF-";
}

/** Flatten the top rows of every sheet into one lowercase blob of header text. */
function readHeaderText(buffer: Buffer): string | null {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  } catch {
    return null;
  }
  const parts: string[] = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null });
    for (const row of rows.slice(0, HEADER_SCAN_ROWS)) {
      for (const cell of row) {
        if (typeof cell === "string") parts.push(cell);
      }
    }
    parts.push(sheetName);
  }
  return parts.join(" | ").replace(/\s+/g, " ");
}

function score(
  text: string,
  signals: Array<{ pattern: RegExp; label: string; weight: number }>
): { total: number; labels: string[] } {
  let total = 0;
  const labels: string[] = [];
  for (const signal of signals) {
    if (signal.pattern.test(text)) {
      total += signal.weight;
      labels.push(signal.label);
    }
  }
  return { total, labels };
}

export function hashFile(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

/**
 * Decide what a file is. Never throws: an unreadable or ambiguous file returns
 * `unknown` with the reason, so the caller can ask the user instead of guessing.
 */
export function detectStatement(buffer: Buffer, fileName: string): StatementDetection {
  const fileHash = hashFile(buffer);

  // Only the bank statement has a PDF reader; a card statement arrives as Excel.
  if (isPdf(buffer, fileName)) {
    return {
      kind: "bank",
      reason: "קובץ PDF — נקרא כדף חשבון בנק",
      matchedSignals: ["PDF"],
      bankScore: 0,
      creditScore: 0,
      fileHash,
    };
  }

  const text = readHeaderText(buffer);
  if (text === null) {
    return {
      kind: "unknown",
      reason: "לא הצלחנו לפתוח את הקובץ — נדרש קובץ אקסל או PDF",
      matchedSignals: [],
      bankScore: 0,
      creditScore: 0,
      fileHash,
    };
  }

  const bank = score(text, BANK_SIGNALS);
  const credit = score(text, CREDIT_SIGNALS);

  if (bank.total === 0 && credit.total === 0) {
    return {
      kind: "unknown",
      reason: "לא זוהו כותרות של דף חשבון או של דוח אשראי",
      matchedSignals: [],
      bankScore: 0,
      creditScore: 0,
      fileHash,
    };
  }
  // A clear winner needs to lead, not merely tie: a file scoring the same on
  // both is more likely mis-read than genuinely mixed.
  if (bank.total === credit.total) {
    return {
      kind: "unknown",
      reason: "הקובץ נראה גם כדף חשבון וגם כדוח אשראי — נדרשת בחירה ידנית",
      matchedSignals: [...bank.labels, ...credit.labels],
      bankScore: bank.total,
      creditScore: credit.total,
      fileHash,
    };
  }

  const isBank = bank.total > credit.total;
  return {
    kind: isBank ? "bank" : "credit",
    reason: isBank
      ? `זוהה דף חשבון בנק לפי: ${bank.labels.join(", ")}`
      : `זוהה דוח כרטיס אשראי לפי: ${credit.labels.join(", ")}`,
    matchedSignals: isBank ? bank.labels : credit.labels,
    bankScore: bank.total,
    creditScore: credit.total,
    fileHash,
  };
}
