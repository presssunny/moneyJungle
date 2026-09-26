/**
 * The slice of parser output that gets recorded and compared: totals, counts and
 * coverage, never the rows — a dump would churn on cosmetics and put employer and
 * supplier names in a file outliving the fixture. Shared by recorder and suites.
 */
import type { ParsedBankStatement } from "../modules/bank/bankParser.service";
import type { ParsedCreditRow } from "../modules/credit/creditParser.service";
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

export interface CreditGolden {
  rows: number;
  net: number;
  nonFinancing: number;
  inProcess: number;
  byType: Record<string, { rows: number; total: number }>;
  /** Non-financing spend by purchase month — the month a row counts in. */
  byMonth: Record<string, number>;
  /** Everything with a charge date, by the month the card charges it. */
  byChargeMonth: Record<string, number>;
  multiPayment: number;
}

export function creditGolden(rows: ParsedCreditRow[]): CreditGolden {
  const cents = (xs: ParsedCreditRow[]) => xs.reduce((sum, r) => sum + Math.round(r.amount * 100), 0) / 100;
  const group = (xs: ParsedCreditRow[], key: (r: ParsedCreditRow) => string) => {
    const out: Record<string, number> = {};
    for (const r of xs) out[key(r)] = Math.round(((out[key(r)] ?? 0) + r.amount) * 100) / 100;
    return out;
  };
  const byType: CreditGolden["byType"] = {};
  for (const r of rows) {
    const entry = byType[r.transactionType] ?? { rows: 0, total: 0 };
    byType[r.transactionType] = { rows: entry.rows + 1, total: Math.round((entry.total + r.amount) * 100) / 100 };
  }
  const nonFinancing = rows.filter((r) => r.transactionType !== "financing");
  return {
    rows: rows.length,
    net: cents(rows),
    nonFinancing: cents(nonFinancing),
    inProcess: cents(rows.filter((r) => r.chargeDate === null && r.transactionType !== "financing")),
    byType,
    byMonth: group(nonFinancing, (r) => r.transactionDate.toISOString().slice(0, 7)),
    byChargeMonth: group(rows.filter((r) => r.chargeDate !== null), (r) => r.chargeDate!.toISOString().slice(0, 7)),
    multiPayment: rows.filter((r) => r.paymentCount > 1).length,
  };
}
