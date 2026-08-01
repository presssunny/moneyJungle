/**
 * The amortisation-schedule parser against the bank's real לוח סילוקין exports.
 *
 * The schedule is the source of truth for a loan's terms (balance, rate, payment,
 * counts, dates) — the statement only reports events against it. A regression
 * here silently rewrites what the app believes a loan costs, so the invariants
 * below are asserted before any recorded number is compared.
 *
 * Without fixtures the suite skips. See tests/fixtures/README.md.
 */
import { describe, expect, it } from "vitest";
import { FixtureName, hasFixture, readFixture } from "../../testing/fixtures";
import { hasGolden, readGolden } from "../../testing/golden";
import { scheduleGolden } from "../../testing/goldenShape";
import { ParsedSchedule, ScheduleParseError, parseLoanSchedule } from "./loanSchedule.parser";

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

function scheduleSuite(title: string, fixture: FixtureName, goldenKey: string) {
  describe.skipIf(!hasFixture(fixture))(title, () => {
    const s: ParsedSchedule = parseLoanSchedule(readFixture(fixture));

    it("קרא את כל שורות הלוח", () => {
      expect(s.rows.length).toBeGreaterThan(0);
      expect(s.rows.length).toBe(s.paymentsRemaining);
    });

    /**
     * The decisive check: the principal columns of the remaining rows must add
     * up to the balance the bank states. If the parser grabbed the wrong column
     * — interest instead of principal, or the total instead of either — the sum
     * misses and the loan's whole cost picture is wrong.
     */
    it("Σקרן של השורות הנותרות = יתרת הקרן שהבנק מציין", () => {
      expect(s.checks.principalSumMatchesBalance).toBe(true);
      expect(s.checks.principalSum).toBe(s.currentBalance);
      const summed = round2(s.rows.reduce((sum, r) => sum + r.principal, 0));
      expect(Math.abs(summed - s.currentBalance)).toBeLessThan(0.05);
    });

    /** A rate reconstructed per row must be the same rate on every row. */
    it("הריבית עקבית לאורך כל הלוח", () => {
      expect(s.annualInterestRate).toBeGreaterThan(0);
      expect(s.checks.rateSpreadPpm).toBeLessThan(100); // ppm — well under a basis point
    });

    it("ספירת התשלומים מתיישבת", () => {
      expect(s.paymentsMade + s.paymentsRemaining).toBe(s.totalPayments);
      expect(s.paymentsMade).toBeGreaterThanOrEqual(0);
      expect(s.paymentsRemaining).toBeGreaterThan(0);
    });

    it("כל שורה: קרן + ריבית = תשלום, והיתרה יורדת", () => {
      let previous = Infinity;
      for (const row of s.rows) {
        expect(round2(row.principal + row.interest)).toBeCloseTo(row.total, 1);
        expect(row.balanceAfter).toBeLessThan(previous);
        expect(row.balanceAfter).toBeGreaterThanOrEqual(0);
        expect(row.paymentDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        previous = row.balanceAfter;
      }
      expect(s.rows[s.rows.length - 1].balanceAfter).toBeLessThan(0.05); // ends at zero
    });

    it("השורות מסודרות כרונולוגית ובמספור רץ", () => {
      const numbers = s.rows.map((r) => r.paymentNumber);
      expect([...numbers].sort((a, b) => a - b)).toEqual(numbers);
      const dates = s.rows.map((r) => r.paymentDate);
      expect([...dates].sort()).toEqual(dates);
    });

    it("התשלום הבא קודם לתאריך הסיום", () => {
      expect(s.nextPaymentDate <= s.expectedEndDate).toBe(true);
      expect(s.rows[0].paymentDate).toBe(s.nextPaymentDate);
      expect(s.rows[s.rows.length - 1].paymentDate).toBe(s.expectedEndDate);
    });

    /**
     * The opening amount is either stated in the contract or reconstructed. It
     * must never read as smaller than what is still owed — that would render a
     * negative progress bar.
     */
    it("הסכום המקורי לעולם אינו קטן מהיתרה הנוכחית", () => {
      expect(s.originalAmount).toBeGreaterThanOrEqual(s.currentBalance);
      expect(["contract", "reconstructed"]).toContain(s.originalAmountSource);
      expect(round2(s.originalAmount - s.currentBalance)).toBe(s.principalPaid);
    });

    it("ההתקדמות בין 0 ל־100", () => {
      expect(s.progressPercent).toBeGreaterThanOrEqual(0);
      expect(s.progressPercent).toBeLessThanOrEqual(100);
    });

    it("הריבית העתידית = Σריבית של השורות הנותרות", () => {
      const summed = round2(s.rows.reduce((sum, r) => sum + r.interest, 0));
      expect(Math.abs(summed - s.remainingInterest)).toBeLessThan(0.05);
    });

    it.skipIf(!hasGolden(goldenKey))("הנתונים זהים ל־golden שנרשם", () => {
      expect(scheduleGolden(s)).toEqual(readGolden(goldenKey));
    });
  });
}

scheduleSuite("לוח סילוקין — הלוואה 108 / מסלול 432", "loanSchedule432", "schedule/432");
scheduleSuite("לוח סילוקין — הלוואה 108 / מסלול 562", "loanSchedule562", "schedule/562");

/**
 * Loan 108 runs as two sub-tracks. They must stay separable: merging them would
 * report one loan at a blended rate that neither track actually carries.
 */
describe.skipIf(!hasFixture("loanSchedule432") || !hasFixture("loanSchedule562"))(
  "שני מסלולים של אותה הלוואה",
  () => {
    const a = parseLoanSchedule(readFixture("loanSchedule432"));
    const b = parseLoanSchedule(readFixture("loanSchedule562"));

    it("אותו מספר הלוואה, מסלולים שונים", () => {
      expect(a.loanNumber).toBe(b.loanNumber);
      expect(a.trackNumber).not.toBe(b.trackNumber);
    });

    it("לכל מסלול ריבית ותנאים משלו — אין למזג אותם", () => {
      expect(a.annualInterestRate).not.toBe(b.annualInterestRate);
      expect(a.currentBalance).not.toBe(b.currentBalance);
    });
  }
);

describe("טיפול בקובץ פסול", () => {
  it("זורק ScheduleParseError על קובץ שאינו לוח סילוקין", () => {
    expect(() => parseLoanSchedule(Buffer.from("not a spreadsheet"))).toThrow();
  });

  it("ScheduleParseError הוא Error", () => {
    expect(new ScheduleParseError("בדיקה")).toBeInstanceOf(Error);
  });
});
