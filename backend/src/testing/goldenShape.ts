/**
 * The slice of parser output that gets recorded and compared.
 *
 * Deliberately narrow: totals, counts and coverage — never the rows themselves.
 * A full row dump would break on every cosmetic change and would put descriptions
 * (employer names, suppliers) into a file that outlives the fixture.
 *
 * Shared by the recorder script and the golden suites, so the two can never
 * compare different things.
 */
import type { ParsedBankStatement } from "../modules/bank/bankParser.service";
import type { ParsedSchedule } from "../modules/loans/loanSchedule.parser";

export interface BankGolden {
  parser: string;
  rows: number;
  rowsDetected: number;
  rowsRejected: number;
  openingBalance: number | null;
  closingBalance: number | null;
  coverageFrom: string | null;
  coverageTo: string | null;
  money: ParsedBankStatement["report"]["money"];
  byLineKind: Record<string, number>;
  balanceMismatches: number;
  loanFinancing: Array<{ loanRef: string; interestChargedGross: number; lines: number }>;
  monthFinancing: Array<{ month: string; charged: number; refunded: number; net: number }>;
}

export function bankGolden(statement: ParsedBankStatement): BankGolden {
  const r = statement.report;
  return {
    parser: r.parser,
    rows: statement.rows.length,
    rowsDetected: r.rowsDetected,
    rowsRejected: r.rowsRejected,
    openingBalance: r.openingBalance,
    closingBalance: r.closingBalance,
    coverageFrom: r.coverageFrom,
    coverageTo: r.coverageTo,
    money: r.money,
    byLineKind: { ...r.byLineKind },
    balanceMismatches: r.balanceMismatches.length,
    loanFinancing: r.loanFinancing.map((l) => ({ ...l })),
    monthFinancing: r.monthFinancing.map((m) => ({ ...m })),
  };
}

export interface ScheduleGolden {
  loanNumber: string | null;
  trackNumber: string | null;
  trackName: string | null;
  currentBalance: number;
  annualInterestRate: number;
  monthlyPayment: number;
  paymentsMade: number;
  paymentsRemaining: number;
  totalPayments: number;
  nextPaymentDate: string;
  expectedEndDate: string;
  remainingInterest: number;
  originalAmount: number;
  originalAmountSource: "contract" | "reconstructed";
  principalPaid: number;
  interestPaid: number;
  progressPercent: number;
  rows: number;
  principalSum: number;
  principalSumMatchesBalance: boolean;
  rateSpreadPpm: number;
}

export function scheduleGolden(s: ParsedSchedule): ScheduleGolden {
  return {
    loanNumber: s.loanNumber,
    trackNumber: s.trackNumber,
    trackName: s.trackName,
    currentBalance: s.currentBalance,
    annualInterestRate: s.annualInterestRate,
    monthlyPayment: s.monthlyPayment,
    paymentsMade: s.paymentsMade,
    paymentsRemaining: s.paymentsRemaining,
    totalPayments: s.totalPayments,
    nextPaymentDate: s.nextPaymentDate,
    expectedEndDate: s.expectedEndDate,
    remainingInterest: s.remainingInterest,
    originalAmount: s.originalAmount,
    originalAmountSource: s.originalAmountSource,
    principalPaid: s.principalPaid,
    interestPaid: s.interestPaid,
    progressPercent: s.progressPercent,
    rows: s.rows.length,
    principalSum: s.checks.principalSum,
    principalSumMatchesBalance: s.checks.principalSumMatchesBalance,
    rateSpreadPpm: s.checks.rateSpreadPpm,
  };
}
