import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { hasFixture, readFixture } from "../../testing/fixtures";
import { hasGolden, readGolden } from "../../testing/golden";
import { creditGolden } from "../../testing/goldenShape";
import { parseCreditFile } from "./creditParser.service";

const day = (d: Date | null) => d?.toISOString().slice(0, 10) ?? null;

/** A statement in Cal's own layout, with real Excel date cells. */
function calWorkbook(rows: Array<[Date, string, number, Date | null, string, string]>) {
  const sheet = XLSX.utils.aoa_to_sheet([
    ["פירוט עסקאות לדוגמה"],
    ["תאריך\nעסקה", "שם בית עסק", "סכום\nבש\"ח", "מועד\nחיוב", "סוג\nעסקה", "הערות"],
    ...rows,
  ], { cellDates: true });
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "פירוט עסקאות וזיכויים");
  return XLSX.write(book, { type: "buffer", bookType: "xlsx", cellDates: true }) as Buffer;
}
// Excel cells carry local midnight; this is what SheetJS hands back for them in Israel.
const local = (y: number, m: number, d: number) => new Date(y, m - 1, d);

describe("Cal statement dates and payments", () => {
  it("keeps the printed day, including the first of the month", () => {
    const [row] = parseCreditFile(calWorkbook([[local(2026, 5, 1), "קפה", 18, local(2026, 5, 15), "רגילה", ""]]));
    expect(day(row.transactionDate)).toBe("2026-05-01");
    expect(day(row.chargeDate)).toBe("2026-05-15");
  });

  it("reads the number of payments from Cal's note, and nothing else as one", () => {
    const rows = parseCreditFile(calWorkbook([
      [local(2026, 6, 15), "חנות", 320, null, "תשלומים", "עסקה ב-2 תשלומים"],
      [local(2026, 6, 10), "יתרת אשראי מתגלגל", 25.21, null, "רכישה בקרדיט", "עסקה ב-1 תשלומי קרדיט"],
      [local(2026, 6, 12), "מסעדה", 90, local(2026, 7, 10), "רגילה", "סכום העסקה הוא 20.0 $"],
      [local(2026, 6, 13), "רהיטים", 500, local(2026, 7, 10), "תשלומים", "תשלום 3 מתוך 12"],
    ]));
    expect(rows.map((r) => r.paymentCount)).toEqual([2, 1, 1, 12]);
    expect(rows.map((r) => r.installmentNumber)).toEqual([null, null, null, 3]);
  });
});

describe.skipIf(!hasFixture("creditStatement"))("Cal statement — real file", () => {
  const buffer = readFixture("creditStatement");
  const rows = parseCreditFile(buffer);
  const sheet = XLSX.read(buffer).Sheets[XLSX.read(buffer).SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false, defval: "" });

  it("every row keeps the day Cal printed", () => {
    const printed = raw.slice(2).filter((r) => /^\d{1,2}\/\d{1,2}\/\d{2}$/.test(String(r[0])));
    expect(printed.length).toBe(rows.length);
    printed.forEach((r, i) => {
      const [d, m, y] = String(r[0]).split("/").map(Number);
      expect(day(rows[i].transactionDate)).toBe(`20${String(y).padStart(2, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
    });
  });

  it.skipIf(!hasGolden("credit/cal"))("matches the recorded golden", () => {
    expect(creditGolden(rows)).toEqual(readGolden("credit/cal"));
  });

  it("adds up to Cal's own sheet total once rows still being processed are set aside", () => {
    const totalRow = raw.find((r) => r.some((c) => String(c).includes("סה\"כ עסקאות בגיליון")));
    const printedTotal = Number(String(totalRow!.find((c) => String(c).includes("₪"))).replace(/[₪,\s]/g, ""));
    const inProcess = rows.filter((r) => r.chargeDate === null && r.transactionType !== "financing");
    const cents = (xs: typeof rows) => xs.reduce((s, r) => s + Math.round(r.amount * 100), 0);
    expect((cents(rows) - cents(inProcess)) / 100).toBe(printedTotal);
  });
});
