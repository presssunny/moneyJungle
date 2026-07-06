import { round2 } from "../../utils/money.utils";

/** Annual interest rate (%) at or above this is flagged as expensive. */
export const EXPENSIVE_LOAN_THRESHOLD = 8;

const MAX_MONTHS = 600; // 50 years — simulation guard

export interface LoanInput {
  currentBalance: number;
  annualInterestRate: number; // percent, e.g. 8.5
  monthlyPayment: number;
}

export interface LoanComputed {
  /** Monthly rate in percent (annual / 12) */
  monthlyInterestRate: number;
  /** Interest part of the next payment */
  monthlyInterestPayment: number;
  /** Principal part of the next payment */
  monthlyPrincipalPayment: number;
  /** Total interest projected over the next 12 months (or until payoff) */
  estimatedAnnualInterest: number;
  /** Months until the balance is paid off — null when the payment doesn't cover interest */
  remainingMonths: number | null;
  /** Total interest left until payoff — null when payment doesn't cover interest */
  totalRemainingInterest: number | null;
  isExpensive: boolean;
}

/**
 * Spitzer amortization: each payment M splits into interest (balance * i)
 * and principal (M - interest). Projections run month-by-month.
 */
export function computeLoan(input: LoanInput): LoanComputed {
  const i = input.annualInterestRate / 100 / 12;
  const monthlyInterestPayment = round2(input.currentBalance * i);
  const monthlyPrincipalPayment = round2(Math.max(input.monthlyPayment - monthlyInterestPayment, 0));

  let balance = input.currentBalance;
  let months = 0;
  let totalInterest = 0;
  let first12Interest = 0;
  let paidOff = false;

  while (balance > 0.005 && months < MAX_MONTHS) {
    const interest = balance * i;
    const principal = input.monthlyPayment - interest;
    if (principal <= 0) break; // payment doesn't cover interest — never pays off
    totalInterest += interest;
    if (months < 12) first12Interest += interest;
    balance -= Math.min(principal, balance);
    months += 1;
    if (balance <= 0.005) paidOff = true;
  }

  return {
    monthlyInterestRate: round2((input.annualInterestRate / 12) * 100) / 100,
    monthlyInterestPayment,
    monthlyPrincipalPayment,
    estimatedAnnualInterest: round2(first12Interest),
    remainingMonths: paidOff ? months : null,
    totalRemainingInterest: paidOff ? round2(totalInterest) : null,
    isExpensive: input.annualInterestRate >= EXPENSIVE_LOAN_THRESHOLD,
  };
}

/** Spitzer fixed monthly payment for principal P, annual rate (%), n months. */
export function spitzerMonthlyPayment(principal: number, annualRatePercent: number, months: number): number {
  const i = annualRatePercent / 100 / 12;
  if (months <= 0) return 0;
  if (i === 0) return round2(principal / months);
  return round2((principal * i) / (1 - Math.pow(1 + i, -months)));
}

export interface AmortizationRow {
  month: number;
  interest: number;
  principal: number;
  balance: number;
}

/** Month-by-month payoff schedule (capped for charting). */
export function amortizationSchedule(input: LoanInput, cap = 120): AmortizationRow[] {
  const i = input.annualInterestRate / 100 / 12;
  const rows: AmortizationRow[] = [];
  let balance = input.currentBalance;

  for (let month = 1; month <= cap && balance > 0.005; month += 1) {
    const interest = balance * i;
    const principal = input.monthlyPayment - interest;
    if (principal <= 0) break;
    balance -= Math.min(principal, balance);
    rows.push({
      month,
      interest: round2(interest),
      principal: round2(principal),
      balance: round2(Math.max(balance, 0)),
    });
  }
  return rows;
}
