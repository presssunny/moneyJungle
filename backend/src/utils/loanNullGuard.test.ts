import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// decimalToNumber turns an unknown loan balance/rate/opening amount into 0 —
// "paid off" or "0%". Loan fields go through decimalOrNull / loanFigures.
const ZERO_FOR_UNKNOWN = /decimalToNumber\(\s*[\w.]*\.(currentBalance|originalAmount|annualInterestRate)\)/;

const SRC = path.resolve(__dirname, "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [full] : [];
  });
}

describe("an unknown loan value is never read as 0", () => {
  it("catches the pattern it is meant to catch", () => {
    expect(ZERO_FOR_UNKNOWN.test("const b = decimalToNumber(loan.currentBalance);")).toBe(true);
    expect(ZERO_FOR_UNKNOWN.test("decimalToNumber(goal.loan.annualInterestRate)")).toBe(true);
    expect(ZERO_FOR_UNKNOWN.test("decimalOrNull(loan.currentBalance)")).toBe(false);
  });

  it("no source file converts a loan's balance, rate or opening amount with decimalToNumber", () => {
    const offenders = sourceFiles(SRC).flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .flatMap((line, i) => (ZERO_FOR_UNKNOWN.test(line) ? [`${path.relative(SRC, file)}:${i + 1}`] : []))
    );
    expect(offenders).toEqual([]);
  });
});
