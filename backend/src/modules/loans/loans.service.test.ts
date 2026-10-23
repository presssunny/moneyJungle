import { describe, expect, it } from "vitest";
import { computeLoan } from "./loanCalculator.service";
import { loanTotals } from "./loans.service";

const known = { currentBalance: 42000, annualInterestRate: 5.2, monthlyPayment: 1280 };
const knownComputed = computeLoan(known);

describe("loanTotals", () => {
  it("sums only known balances and interest, and counts the unknown ones instead of treating them as 0", () => {
    const totals = loanTotals([
      { ...known, computed: knownComputed },
      { currentBalance: null, monthlyPayment: 900, computed: null },
    ]);
    expect(totals.knownBalance).toBe(42000);
    expect(totals.unknownBalanceCount).toBe(1);
    expect(totals.knownMonthlyInterest).toBe(knownComputed.monthlyInterestPayment);
    expect(totals.knownAnnualInterest).toBe(knownComputed.estimatedAnnualInterest);
    expect(totals.unknownInterestCount).toBe(1);
  });

  it("still counts the monthly payment of a loan whose balance is unknown — the debit is real", () => {
    const totals = loanTotals([
      { ...known, computed: knownComputed },
      { currentBalance: null, monthlyPayment: 900, computed: null },
    ]);
    expect(totals.monthlyPayment).toBe(2180);
  });

  it("keeps a manual 0% loan as a known 0 interest, not unknown", () => {
    const zero = { currentBalance: 10000, annualInterestRate: 0, monthlyPayment: 500 };
    const totals = loanTotals([{ ...zero, computed: computeLoan(zero) }]);
    expect(totals.knownBalance).toBe(10000);
    expect(totals.knownMonthlyInterest).toBe(0);
    expect(totals.unknownInterestCount).toBe(0);
    expect(totals.unknownBalanceCount).toBe(0);
  });

  it("counts a known balance with an unknown rate as unknown interest only", () => {
    const totals = loanTotals([{ currentBalance: 5000, monthlyPayment: 300, computed: null }]);
    expect(totals.knownBalance).toBe(5000);
    expect(totals.unknownBalanceCount).toBe(0);
    expect(totals.unknownInterestCount).toBe(1);
  });
});
