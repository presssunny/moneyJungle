import * as XLSX from "xlsx";

export type SheetCell = string | number | Date | boolean | null | undefined;

/**
 * The calendar day a spreadsheet cell shows, as a UTC-midnight Date — shared by
 * every statement parser; a second copy once put every Cal date a day early.
 */
export function parseCellDate(value: SheetCell): Date | null {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    // SheetJS decodes Excel serials with a sub-minute drift (28/07 arrives as
    // 23:59:20 on the 27th), so truncating lost a day on every row. Round to the
    // nearest local midnight, then anchor to UTC — `@db.Date` keeps the UTC day.
    const dayMs = 24 * 60 * 60 * 1000;
    const localMs = value.getTime() - value.getTimezoneOffset() * 60_000;
    return new Date(Math.round(localMs / dayMs) * dayMs);
  }
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
      const [dayOfMonth, month] = [Number(dmy[1]), Number(dmy[2])];
      if (month < 1 || month > 12 || dayOfMonth < 1 || dayOfMonth > 31) return null;
      return new Date(Date.UTC(year, month - 1, dayOfMonth));
    }
    return null;
  }
  return null;
}
