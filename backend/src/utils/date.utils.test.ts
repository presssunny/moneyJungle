import { afterEach, describe, expect, it, vi } from "vitest";
import { addDays, daysUntil, monthRange, parseMonthKey, startOfToday, toMonthKey } from "./date.utils";

describe("monthRange", () => {
  it("returns a half-open UTC range [start, end)", () => {
    const { start, end } = monthRange(2026, 7);
    expect(start.toISOString()).toBe("2026-07-01T00:00:00.000Z");
    expect(end.toISOString()).toBe("2026-08-01T00:00:00.000Z");
  });

  it("rolls December into the next January", () => {
    const { start, end } = monthRange(2026, 12);
    expect(start.toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(end.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("handles February in a leap year", () => {
    expect(monthRange(2028, 2).end.toISOString()).toBe("2028-03-01T00:00:00.000Z");
  });

  /**
   * The end is exclusive. A transaction stamped at midnight on the 1st belongs to
   * the NEXT month — if it were inclusive it would be counted in both.
   */
  it("excludes the first instant of the following month", () => {
    const { end } = monthRange(2026, 7);
    expect(new Date("2026-08-01T00:00:00.000Z") < end).toBe(false);
    expect(new Date("2026-07-31T23:59:59.999Z") < end).toBe(true);
  });
});

describe("parseMonthKey", () => {
  it("parses a well-formed key", () => {
    expect(parseMonthKey("2026-07")).toEqual({ year: 2026, month: 7 });
    expect(parseMonthKey("2026-12")).toEqual({ year: 2026, month: 12 });
  });

  it("rejects an out-of-range month", () => {
    expect(parseMonthKey("2026-00")).toBeNull();
    expect(parseMonthKey("2026-13")).toBeNull();
  });

  it("rejects malformed input instead of guessing", () => {
    expect(parseMonthKey("2026-7")).toBeNull(); // unpadded
    expect(parseMonthKey("07-2026")).toBeNull();
    expect(parseMonthKey("")).toBeNull();
    expect(parseMonthKey("2026-07-01")).toBeNull();
  });
});

describe("toMonthKey", () => {
  it("zero-pads the month so keys sort lexicographically", () => {
    expect(toMonthKey(2026, 7)).toBe("2026-07");
    expect(toMonthKey(2026, 12)).toBe("2026-12");
    expect(["2026-12", "2026-07"].sort()).toEqual(["2026-07", "2026-12"]);
  });

  it("round-trips with parseMonthKey", () => {
    expect(parseMonthKey(toMonthKey(2026, 3))).toEqual({ year: 2026, month: 3 });
  });
});

describe("addDays", () => {
  it("adds days without mutating the input", () => {
    const base = new Date("2026-07-15T10:00:00.000Z");
    const later = addDays(base, 10);
    expect(later.getTime()).toBeGreaterThan(base.getTime());
    expect(base.toISOString()).toBe("2026-07-15T10:00:00.000Z");
  });

  it("crosses a month boundary", () => {
    expect(addDays(new Date("2026-07-30T12:00:00.000Z"), 5).getUTCMonth()).toBe(7); // August
  });

  it("accepts a negative offset", () => {
    expect(addDays(new Date("2026-07-15T12:00:00.000Z"), -20).getUTCMonth()).toBe(5); // June
  });
});

describe("startOfToday / daysUntil", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("counts whole days to a future date", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-15T12:00:00.000Z"));
    expect(daysUntil(new Date("2026-07-20T00:00:00.000Z"))).toBe(5);
  });

  it("returns 0 for today and a negative number once the date has passed", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-15T12:00:00.000Z"));
    expect(daysUntil(startOfToday())).toBe(0);
    expect(daysUntil(new Date("2026-07-10T00:00:00.000Z"))).toBe(-5);
  });

  /**
   * Documents current behaviour, not an endorsement: startOfToday reads the
   * LOCAL calendar day and stamps it as UTC midnight. Under a positive TZ offset
   * that is the same wall-clock day, which is what a reminder means to the user.
   * A future TZ change here would break reminder countdowns, so it is pinned.
   */
  it("anchors the local calendar day at UTC midnight", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-15T12:00:00.000Z"));
    const today = startOfToday();
    expect(today.getUTCHours()).toBe(0);
    expect(today.getUTCMinutes()).toBe(0);
    expect(today.getUTCDate()).toBe(new Date().getDate());
  });
});
