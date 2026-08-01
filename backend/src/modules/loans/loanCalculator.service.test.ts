import { describe, expect, it } from "vitest";
import {
  amortizationSchedule,
  computeLoan,
  ENDING_SOON_PAYMENTS,
  EXPENSIVE_LOAN_THRESHOLD,
  loanProgress,
  spitzerMonthlyPayment,
} from "./loanCalculator.service";

/** Loan 108 / track 432, exactly as the bank's לוח סילוקין states it. */
const LOAN_432 = { currentBalance: 87646.82, annualInterestRate: 9.4, monthlyPayment: 1886 };

describe("computeLoan — Spitzer split", () => {
  it("splits the next payment into interest and principal", () => {
    const r = computeLoan(LOAN_432);
    // 87,646.82 × 9.4% / 12 = 686.57
    expect(r.monthlyInterestPayment).toBe(686.57);
    expect(r.monthlyPrincipalPayment).toBe(1199.43);
    expect(r.monthlyInterestPayment + r.monthlyPrincipalPayment).toBeCloseTo(1886, 2);
  });

  it("pays the loan off in a plausible number of months", () => {
    const r = computeLoan(LOAN_432);
    expect(r.remainingMonths).not.toBeNull();
    // The bank's schedule says 58 payments left; a simulation from the balance
    // alone lands near it. Anything far off means the rate handling broke.
    expect(r.remainingMonths!).toBeGreaterThan(50);
    expect(r.remainingMonths!).toBeLessThan(70);
  });

  it("never claims a payoff when the payment does not cover the interest", () => {
    const r = computeLoan({ currentBalance: 100_000, annualInterestRate: 12, monthlyPayment: 500 });
    expect(r.remainingMonths).toBeNull();
    expect(r.totalRemainingInterest).toBeNull();
    // 500 < 1,000 monthly interest — the principal part is clamped, never negative.
    expect(r.monthlyPrincipalPayment).toBe(0);
  });

  it("handles a zero-interest loan", () => {
    const r = computeLoan({ currentBalance: 1200, annualInterestRate: 0, monthlyPayment: 100 });
    expect(r.monthlyInterestPayment).toBe(0);
    expect(r.remainingMonths).toBe(12);
    expect(r.totalRemainingInterest).toBe(0);
  });

  /**
   * Characterisation, not endorsement. The simulation loop never runs on a zero
   * balance, so `paidOff` stays false and a settled loan reports `null` — the
   * same value that means "the payment never covers the interest". The two are
   * opposite situations sharing one signal.
   *
   * Nothing is broken today: `loanProgress` decides "closed" from the balance
   * before it ever looks here. Pinned so that if the null is ever given a
   * meaning of its own, this fails loudly instead of drifting.
   */
  it("returns null — not 0 — for an already settled loan", () => {
    const r = computeLoan({ currentBalance: 0, annualInterestRate: 9.4, monthlyPayment: 1886 });
    expect(r.remainingMonths).toBeNull();
    expect(r.totalRemainingInterest).toBeNull();
    expect(r.monthlyInterestPayment).toBe(0);
  });

  it("counts only the first 12 months into the annual interest estimate", () => {
    const r = computeLoan(LOAN_432);
    expect(r.estimatedAnnualInterest).toBeLessThan(r.totalRemainingInterest!);
    expect(r.estimatedAnnualInterest).toBeLessThan(r.monthlyInterestPayment * 12);
  });

  it("flags an expensive rate at the threshold, not above it", () => {
    expect(computeLoan({ ...LOAN_432, annualInterestRate: EXPENSIVE_LOAN_THRESHOLD }).isExpensive).toBe(true);
    expect(computeLoan({ ...LOAN_432, annualInterestRate: EXPENSIVE_LOAN_THRESHOLD - 0.1 }).isExpensive).toBe(false);
  });
});

describe("loanProgress", () => {
  const base = {
    status: "active",
    originalAmount: 90017.86,
    currentBalance: 87646.82,
    monthlyPayment: 1886,
    annualInterestRate: 9.4,
    totalPayments: 60,
    paymentsMade: 2,
    originalAmountSource: "bank_file",
    scheduleSource: "bank_file",
  };

  it("matches the bank's own progress figures for loan 108/432", () => {
    const p = loanProgress(base);
    expect(p.principalRepaid).toBe(2371.04);
    expect(p.progressPercent).toBe(2.63);
    expect(p.paymentsRemaining).toBe(58);
    expect(p.lifecycle).toBe("active");
  });

  /** A stale balance must never render a 103% bar. */
  it("caps progress at 100 when the balance is stale", () => {
    expect(loanProgress({ ...base, currentBalance: -5000 }).progressPercent).toBe(100);
  });

  it("never reports negative repayment when the balance grew", () => {
    const p = loanProgress({ ...base, currentBalance: 95_000 });
    expect(p.principalRepaid).toBe(0);
    expect(p.progressPercent).toBe(0);
  });

  it("marks the last payments as ending_soon so the freed-up money is visible early", () => {
    expect(loanProgress({ ...base, paymentsMade: 60 - ENDING_SOON_PAYMENTS }).lifecycle).toBe("ending_soon");
    expect(loanProgress({ ...base, paymentsMade: 60 - ENDING_SOON_PAYMENTS - 1 }).lifecycle).toBe("active");
  });

  it("treats a zero balance as closed even while the status still says active", () => {
    const p = loanProgress({ ...base, currentBalance: 0 });
    expect(p.lifecycle).toBe("closed");
    expect(p.progressPercent).toBe(100);
    expect(p.paymentsRemaining).toBe(0);
  });

  it("keeps an overdue loan overdue", () => {
    expect(loanProgress({ ...base, status: "overdue" }).lifecycle).toBe("overdue");
  });

  it("falls back to simulation when the schedule has no payment counts", () => {
    const p = loanProgress({ ...base, totalPayments: null, paymentsMade: null });
    expect(p.paymentsRemaining).not.toBeNull();
    expect(p.paymentsRemaining!).toBeGreaterThan(50);
  });

  /**
   * Certainty drives whether the UI shows a number or a hedged scenario. A
   * reconstructed opening amount can never read as "measured".
   */
  it("is measured only when both the schedule and the opening amount came from the bank", () => {
    expect(loanProgress(base).certainty).toBe("measured");
    expect(loanProgress({ ...base, originalAmountSource: "reconstructed" }).certainty).toBe("scenario");
    expect(loanProgress({ ...base, scheduleSource: "simulated" }).certainty).toBe("scenario");
  });
});

describe("spitzerMonthlyPayment", () => {
  it("reproduces the bank's monthly payment from principal, rate and term", () => {
    // Loan 108/432: 90,017.86 over 60 months at 9.4% → the bank charges 1,886.
    expect(spitzerMonthlyPayment(90017.86, 9.4, 60)).toBeCloseTo(1886, 0);
  });

  it("divides evenly at zero interest", () => {
    expect(spitzerMonthlyPayment(1200, 0, 12)).toBe(100);
  });

  it("returns 0 for a non-positive term instead of dividing by zero", () => {
    expect(spitzerMonthlyPayment(1000, 5, 0)).toBe(0);
    expect(spitzerMonthlyPayment(1000, 5, -3)).toBe(0);
  });
});

describe("amortizationSchedule", () => {
  it("shrinks the balance to zero and shifts interest into principal over time", () => {
    const rows = amortizationSchedule(LOAN_432);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[rows.length - 1].balance).toBe(0);
    expect(rows[0].interest).toBeGreaterThan(rows[rows.length - 1].interest);
    expect(rows[0].principal).toBeLessThan(rows[rows.length - 1].principal);
  });

  it("numbers months from 1 and never goes past the cap", () => {
    const rows = amortizationSchedule(LOAN_432, 12);
    expect(rows).toHaveLength(12);
    expect(rows[0].month).toBe(1);
    expect(rows[11].month).toBe(12);
  });

  it("returns nothing when the payment cannot cover the interest", () => {
    expect(amortizationSchedule({ currentBalance: 100_000, annualInterestRate: 12, monthlyPayment: 500 })).toEqual([]);
  });

  it("agrees with computeLoan on the first month's split", () => {
    const [first] = amortizationSchedule(LOAN_432);
    const computed = computeLoan(LOAN_432);
    expect(first.interest).toBe(computed.monthlyInterestPayment);
    expect(first.principal).toBe(computed.monthlyPrincipalPayment);
  });
});
