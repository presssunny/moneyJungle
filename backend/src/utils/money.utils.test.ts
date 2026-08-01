import { describe, expect, it } from "vitest";
import { Prisma } from "../../generated/prisma/client";
import { decimalToNumber, percent, round2, sumDecimals } from "./money.utils";

describe("round2", () => {
  it("rounds to two decimals", () => {
    expect(round2(1.005)).toBe(1.01);
    expect(round2(2.344)).toBe(2.34);
    expect(round2(2.345)).toBe(2.35);
  });

  it("survives the classic float traps that lose agorot", () => {
    expect(round2(0.1 + 0.2)).toBe(0.3);
    // 1.005 × 100 lands on 100.49999999999999 in float64. Without the EPSILON
    // nudge this would round DOWN to 1.00 and quietly drop an agora per row.
    expect(1.005 * 100).toBeLessThan(100.5);
    expect(round2(1.005)).toBe(1.01);
  });

  it("keeps the sign of a negative amount", () => {
    expect(round2(-2.345)).toBe(-2.34); // Math.round breaks ties toward +∞
    expect(round2(-0.001)).toBe(-0);
  });

  it("leaves whole shekels untouched", () => {
    expect(round2(1886)).toBe(1886);
  });
});

describe("decimalToNumber", () => {
  it("converts a Prisma Decimal", () => {
    expect(decimalToNumber(new Prisma.Decimal("87646.82"))).toBe(87646.82);
  });

  it("passes a plain number through", () => {
    expect(decimalToNumber(1230.21)).toBe(1230.21);
  });

  it("treats null and undefined as zero — a missing amount is not a NaN", () => {
    expect(decimalToNumber(null)).toBe(0);
    expect(decimalToNumber(undefined)).toBe(0);
  });

  it("does not treat 0 as missing", () => {
    expect(decimalToNumber(new Prisma.Decimal(0))).toBe(0);
  });
});

describe("sumDecimals", () => {
  it("sums a mixed list and rounds once at the end", () => {
    expect(sumDecimals([new Prisma.Decimal("0.1"), 0.2, new Prisma.Decimal("0.3")])).toBe(0.6);
  });

  it("skips nulls instead of poisoning the sum", () => {
    expect(sumDecimals([new Prisma.Decimal("100.5"), null, undefined, 50.25])).toBe(150.75);
  });

  it("returns 0 for an empty month", () => {
    expect(sumDecimals([])).toBe(0);
  });

  /**
   * Rounding each item before summing drifts by an agora per row. The dashboard
   * totals go through here, so the drift would surface as a balance that does
   * not tie out.
   */
  it("rounds the total, not the items", () => {
    expect(sumDecimals(Array(3).fill(0.005))).toBe(0.02); // not 3 × 0.01 = 0.03
  });
});

describe("percent", () => {
  it("computes usage against a budget", () => {
    expect(percent(50, 200)).toBe(25);
    expect(percent(1, 3)).toBe(33.33);
  });

  it("returns 0 when there is no budget — never Infinity or NaN in the UI", () => {
    expect(percent(100, 0)).toBe(0);
    expect(percent(100, -5)).toBe(0);
  });

  it("reports over-budget above 100 rather than capping", () => {
    expect(percent(300, 200)).toBe(150);
  });
});
