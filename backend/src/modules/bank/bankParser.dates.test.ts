/**
 * Date handling in the statement parsers.
 *
 * Pure invariants: they encode a RULE about calendar days, carry no figure from
 * any account, and need no fixture — so they run everywhere, always.
 *
 * The rule is worth its own suite because getting it wrong is silent. A date is
 * not just a label: `transactionDate` decides which month a row belongs to, so a
 * one-day slip moves a 1st-of-month payment into the previous month and takes
 * its amount with it. It also breaks import de-duplication, because a row is
 * matched on its date — which is how the same statement could be imported twice.
 */
import { describe, expect, it } from "vitest";
import { parseCellDate } from "./bankParser.service";

/** The calendar day a parsed date represents, as the DB stores it (`@db.Date`). */
function utcDay(date: Date | null): string {
  expect(date).not.toBeNull();
  return date!.toISOString().slice(0, 10);
}

describe("parseCellDate — הימים שהבנק הדפיס", () => {
  /**
   * The regression this suite exists for.
   *
   * SheetJS converts an Excel date serial with a sub-minute drift: in the real
   * statement 28/07/2026 arrives as 2026-07-27T20:59:20Z, i.e. 23:59:20 local on
   * the 27th. Reading the calendar day off that value — however carefully, in UTC
   * or in local time — yields the 27th, so EVERY Excel-imported row lost a day.
   *
   * Rounding to the nearest midnight is what absorbs the drift.
   */
  it("תאריך שהגיע 40 שניות לפני חצות נקרא כיום שהבנק הדפיס, לא כיום שלפניו", () => {
    const drifted = new Date("2026-07-27T20:59:20.000Z"); // = 28/07 בלוח של הבנק (UTC+3)
    expect(utcDay(parseCellDate(drifted))).toBe("2026-07-28");
  });

  it("תאריך נקי בחצות מקומית נשאר על אותו יום", () => {
    const clean = new Date("2026-07-27T21:00:00.000Z"); // חצות מקומית של ה־28
    expect(utcDay(parseCellDate(clean))).toBe("2026-07-28");
  });

  /**
   * A drift across a month boundary is the expensive case: the row does not just
   * move a day, it moves into a different monthly total.
   */
  it("סטייה בתחילת חודש לא מעבירה את השורה לחודש הקודם", () => {
    const firstOfMonth = new Date("2026-06-30T20:59:20.000Z"); // = 01/07
    const parsed = parseCellDate(firstOfMonth);
    expect(utcDay(parsed)).toBe("2026-07-01");
    expect(parsed!.getUTCMonth()).toBe(6); // July, not June
  });

  it("סטייה בסוף שנה לא מעבירה את השורה לשנה הקודמת", () => {
    expect(utcDay(parseCellDate(new Date("2026-12-31T20:59:20.000Z")))).toBe("2027-01-01");
  });

  /** Whatever the input form, the result is a clean UTC midnight — `@db.Date`. */
  it("כל תאריך שנקרא הוא חצות UTC בדיוק", () => {
    const inputs: Array<Date | string | number> = [
      new Date("2026-07-27T20:59:20.000Z"),
      "28/07/2026",
      "2026-07-28",
      "28.07.2026",
    ];
    for (const input of inputs) {
      const parsed = parseCellDate(input as never);
      expect(parsed).not.toBeNull();
      expect(parsed!.getUTCHours()).toBe(0);
      expect(parsed!.getUTCMinutes()).toBe(0);
      expect(parsed!.getUTCSeconds()).toBe(0);
      expect(parsed!.getUTCMilliseconds()).toBe(0);
    }
  });

  /** Every accepted text form must name the same day — DD/MM, never MM/DD. */
  it("כל צורות הכתיבה של אותו יום מגיעות לאותה תוצאה", () => {
    const forms = ["28/07/2026", "28.07.2026", "28-07-2026", "2026-07-28"];
    for (const form of forms) {
      expect(utcDay(parseCellDate(form as never))).toBe("2026-07-28");
    }
  });

  it("יום 03/04 נקרא כ־3 באפריל ולא כ־4 במרץ", () => {
    expect(utcDay(parseCellDate("03/04/2026" as never))).toBe("2026-04-03");
  });

  it("ערך שאינו תאריך מוחזר כ־null ולא כתאריך שגוי", () => {
    for (const junk of ["", "לא תאריך", "—", new Date("nope")]) {
      expect(parseCellDate(junk as never)).toBeNull();
    }
  });
});
