/**
 * File-kind detection — header-text driven, so no fixture needed. Routing is
 * where a mistake costs most: the wrong parser does not fail loudly, it writes
 * plausible nonsense into a real account.
 */
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { detectStatement } from "./statementDetector.service";

/** Build a real .xlsx in memory from header rows, so the detector runs for real. */
function sheetOf(rows: string[][]): Buffer {
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Sheet1");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

const BANK_HEADER = [
  ["תנועות בחשבון"],
  ["", "יתרה", "תאריך ערך", "זכות", "חובה", "תיאור", "אסמכתא", "סוג פעולה", "תאריך"],
];

const CREDIT_HEADER = [
  ["פירוט עסקאות"],
  ["תאריך עסקה", "שם בית עסק", "סכום עסקה", "מועד חיוב", "סוג עסקה", "מספר שובר"],
];

/** The exact shape the bank exports (verified against three real files). */
const SCHEDULE_HEADER = [
  ["לוח סילוקין"],
  ["חשבון: 00-000000"],
  ["סוג הלוואה: 000"],
  ["מספר הלוואה: 000"],
  ["", "מספר תשלום קרן", "תאריך תשלום", "סכום תשלום קרן", "סכום תשלום ריבית", 'סה"כ לתשלום', "יתרה לאחר תשלום קרן"],
];

describe("detectStatement", () => {
  it("דף חשבון מזוהה לפי הכותרות שלו", () => {
    expect(detectStatement(sheetOf(BANK_HEADER), "x.xlsx").kind).toBe("bank");
  });

  it("דוח אשראי מזוהה לפי הכותרות שלו", () => {
    expect(detectStatement(sheetOf(CREDIT_HEADER), "x.xlsx").kind).toBe("credit");
  });

  /**
   * The regression this suite exists for: an amortisation table scored 3 on
   * "יתרה" (from "יתרה לאחר תשלום קרן"), went to the bank parser and wrote 58
   * future-dated rows through 2031 into a live account.
   */
  it("לוח סילוקין לא מזוהה כדף חשבון — גם כשיש בו את המילה 'יתרה'", () => {
    const detection = detectStatement(sheetOf(SCHEDULE_HEADER), "export.xlsx");
    expect(detection.kind).toBe("loan_schedule");
    expect(detection.kind).not.toBe("bank");
  });

  it("הזיהוי של לוח סילוקין מסביר את עצמו", () => {
    const detection = detectStatement(sheetOf(SCHEDULE_HEADER), "export.xlsx");
    expect(detection.reason).toContain("לוח סילוקין");
    expect(detection.matchedSignals.length).toBeGreaterThanOrEqual(2);
  });

  /** One stray word must not be enough — a statement mentioning קרן stays a statement. */
  it("אזכור בודד של 'קרן' בדף חשבון לא הופך אותו ללוח סילוקין", () => {
    const detection = detectStatement(
      sheetOf([...BANK_HEADER, ["", "", "", "", "500", "הלוואה - תשלום קרן", "", "290", "01/01/2026"]]),
      "x.xlsx"
    );
    expect(detection.kind).toBe("bank");
  });

  it("קובץ בלי אף כותרת מוכרת מוחזר כלא מזוהה, לא כניחוש", () => {
    expect(detectStatement(sheetOf([["שלום"], ["עולם"]]), "x.xlsx").kind).toBe("unknown");
  });

  /** The same bytes must always hash the same, or de-duplication breaks. */
  it("אותו קובץ מקבל את אותו hash", () => {
    const buffer = sheetOf(BANK_HEADER);
    expect(detectStatement(buffer, "a.xlsx").fileHash).toBe(detectStatement(buffer, "b.xlsx").fileHash);
  });
});
