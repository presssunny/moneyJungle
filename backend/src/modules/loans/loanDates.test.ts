import { describe, expect, it } from "vitest";
import { nextPaymentDate, startDateMeaning } from "./loanDates";

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const iso = (date: Date | null) => date?.toISOString().slice(0, 10) ?? null;

describe("a loan's next payment", () => {
  it("a detected loan's recorded date is its next payment while it is still ahead", () => {
    expect(iso(nextPaymentDate({ startDate: day("2026-11-15"), scheduleSource: "statement" }, day("2026-10-26")))).toBe("2026-11-15");
    expect(iso(nextPaymentDate({ startDate: day("2026-10-26"), scheduleSource: "statement" }, day("2026-10-26")))).toBe("2026-10-26");
  });

  it("rolls a recorded date that has passed forward on its own day of month", () => {
    expect(iso(nextPaymentDate({ startDate: day("2026-08-10"), scheduleSource: "statement" }, day("2026-10-26")))).toBe("2026-11-10");
  });

  it("an opening date is not a payment: the first one falls a month later", () => {
    expect(iso(nextPaymentDate({ startDate: day("2026-10-26"), scheduleSource: "computed" }, day("2026-10-26")))).toBe("2026-11-26");
    expect(iso(nextPaymentDate({ startDate: day("2020-03-15"), scheduleSource: "computed" }, day("2026-10-26")))).toBe("2026-11-15");
    expect(iso(nextPaymentDate({ startDate: day("2020-03-28"), scheduleSource: "computed" }, day("2026-10-26")))).toBe("2026-10-28");
  });

  it("day 31 lands on the last day of a shorter month", () => {
    expect(iso(nextPaymentDate({ startDate: day("2026-01-31"), scheduleSource: "statement" }, day("2027-02-10")))).toBe("2027-02-28");
  });

  it("says what the stored start date means", () => {
    expect(startDateMeaning({ scheduleSource: "computed" })).toBe("opening");
    expect(startDateMeaning({ scheduleSource: "statement" })).toBe("recorded");
    expect(startDateMeaning({ scheduleSource: "bank_file" })).toBe("recorded");
  });
});
