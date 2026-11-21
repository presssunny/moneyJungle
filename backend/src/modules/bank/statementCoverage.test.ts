import { describe, expect, it } from "vitest";
import { monthCoverageFrom } from "./statementCoverage.service";

const r = (accountId: number, from: string, to: string) => ({ accountId, from, to });
const TODAY = "2026-10-27";

describe("how much of a month the bank statements cover (banker 2026-10-27)", () => {
  it("no statement anywhere near the month is unknown — not partial", () => {
    expect(monthCoverageFrom([], "2026-08", TODAY)).toEqual({ state: "unknown" });
    expect(monthCoverageFrom([r(1, "2026-09-01", "2026-09-30")], "2026-07", TODAY)).toEqual({ state: "unknown" });
  });

  it("a month covered day 1 to the end is complete, with 3 days' slack at the edges", () => {
    expect(monthCoverageFrom([r(1, "2026-07-26", "2026-10-22")], "2026-08", TODAY)).toEqual({ state: "complete", from: "2026-08-01", to: "2026-08-31" });
    expect(monthCoverageFrom([r(1, "2026-09-03", "2026-09-28")], "2026-09", TODAY)).toMatchObject({ state: "complete" });
  });

  it("the sync's first month, starting on the 26th, is partial", () => {
    expect(monthCoverageFrom([r(1, "2026-07-26", "2026-10-22")], "2026-07", TODAY)).toEqual({ state: "partial", from: "2026-07-26", to: "2026-07-31" });
  });

  it("a gap between two statements of one account counts as missing; up to 3 days is a weekend", () => {
    expect(monthCoverageFrom([r(1, "2026-06-01", "2026-08-10"), r(1, "2026-08-20", "2026-09-30")], "2026-08", TODAY)).toMatchObject({ state: "partial" });
    expect(monthCoverageFrom([r(1, "2026-06-01", "2026-08-10"), r(1, "2026-08-14", "2026-09-30")], "2026-08", TODAY)).toMatchObject({ state: "complete" });
    expect(monthCoverageFrom([r(1, "2026-05-01", "2026-06-30"), r(1, "2026-09-01", "2026-09-30")], "2026-08", TODAY)).toMatchObject({ state: "partial" });
  });

  it("with several accounts, every account that reaches the month must cover all of it", () => {
    expect(monthCoverageFrom([r(1, "2026-08-01", "2026-08-31"), r(2, "2026-08-15", "2026-09-30")], "2026-08", TODAY)).toMatchObject({ state: "partial" });
  });

  it("the current month is never complete — it is covered up to the last statement day", () => {
    expect(monthCoverageFrom([r(1, "2026-07-26", "2026-10-22")], "2026-10", TODAY)).toEqual({ state: "to_date", from: "2026-10-01", to: "2026-10-22" });
    expect(monthCoverageFrom([r(1, "2026-10-12", "2026-10-22")], "2026-10", TODAY)).toMatchObject({ state: "partial" });
  });
});
