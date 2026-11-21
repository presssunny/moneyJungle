// Test-only stand-in for steps 8–9 (locate the loan, read its schedule), which need CLAUDE.md §7
// A2/B. No production source may import this (guarded in officialLogin.test.ts); it never touches the page.
import type { LoanDetailsSource } from "../modules/connections/officialLogin";
import type { ScrapedLoan, ScrapedLoanPayment } from "../types/connections.types";

const payment = (paymentNumber: number, date: string, principal: number, interest: number, balanceAfter: number): ScrapedLoanPayment =>
  ({ paymentNumber, date, principal, interest, linkage: 0, total: principal + interest, balanceAfter });

/** Made-up figures, digits only so the schedule parser's \d+ reads them; Σ principal = the balance. */
export const STUB_LOAN_DIGITS: ScrapedLoan = {
  loanNumber: "90001", trackNumber: "301", name: "הלוואה לדוגמה", asOf: "2026-10-31", originalAmount: 6000, principalBalance: 3000, indexedBalance: null,
  interestType: "prime", annualInterestRate: 6, primeMargin: 0.5, indexLinked: false, baseIndex: null, baseIndexMonth: null,
  paymentsMade: 3, paymentsTotal: 6, startDate: "2026-08-01", endDate: "2027-01-01", nextPaymentAmount: 1015, nextPaymentDate: "2026-11-01",
  schedule: [payment(4, "2026-11-01", 1000, 15, 2000), payment(5, "2026-12-01", 1000, 10, 1000), payment(6, "2027-01-01", 1000, 5, 0)],
};

/** As the real worker sends it (§7 A2): the loan number cut to its last 4 digits, a snapshot with no schedule. */
export const STUB_LOAN_LAST4: ScrapedLoan = { ...STUB_LOAN_DIGITS, loanNumber: "0001", schedule: [] };

const track = (loanNumber: string, trackNumber: string, step: number): ScrapedLoan => ({
  ...STUB_LOAN_DIGITS, loanNumber, trackNumber, name: `מסלול ${trackNumber}`, principalBalance: 2 * step, nextPaymentAmount: step + 4,
  schedule: [payment(1, "2026-11-10", step, 4, step), payment(2, "2026-12-10", step, 2, 0)],
});
/** Two loans, the second with two tracks: three schedules, three sessions. */
export const STUB_LOANS_TRACKS: ScrapedLoan[] = [track("90001", "301", 500), track("90002", "301", 700), track("90002", "302", 900)];

export type FakeLoanScenario = "one" | "last4" | "tracks" | "unavailable" | "not-approved" | "malformed" | "unreadable-id" | "incomplete" | "index-linked" | "hang" | "throws";

/** A malformed read: a field the bank renamed. Passes through as `unknown[]`; the parent's schema rejects it. */
const MALFORMED: unknown[] = [{ ...STUB_LOAN_DIGITS, yitra: 1 }];

const answers: Record<FakeLoanScenario, () => ReturnType<LoanDetailsSource["read"]>> = {
  one: async () => ({ status: "READ", loans: [STUB_LOAN_DIGITS] }),
  last4: async () => ({ status: "READ", loans: [STUB_LOAN_LAST4] }),
  tracks: async () => ({ status: "READ", loans: STUB_LOANS_TRACKS }),
  unavailable: async () => ({ status: "UNAVAILABLE" }),
  "not-approved": async () => ({ status: "NOT_APPROVED" }),
  malformed: async () => ({ status: "READ", loans: MALFORMED }),
  "unreadable-id": async () => ({ status: "READ", loans: [{ ...STUB_LOAN_DIGITS, loanNumber: "LN-1" }] }),
  incomplete: async () => ({ status: "READ", loans: [{ ...STUB_LOAN_DIGITS, schedule: STUB_LOAN_DIGITS.schedule.map((row, i) => (i === 1 ? { ...row, interest: null } : row)) }] }),
  "index-linked": async () => ({ status: "READ", loans: [{ ...STUB_LOAN_DIGITS, indexLinked: true }] }),
  hang: () => new Promise(() => {}),
  throws: async () => { throw new Error("details page changed"); },
};

export const isFakeLoanScenario = (name: unknown): name is FakeLoanScenario => typeof name === "string" && name in answers;

/** The scenario's answer without a page: what the stub worker hands back in place of officialLogin's read. */
export const fakeLoanAnswer = (scenario: FakeLoanScenario) => answers[scenario]();

/** A source answering as `scenario`; `calls` counts reads, so a test can prove the step never ran. */
export function fakeLoanDetails(scenario: FakeLoanScenario): LoanDetailsSource & { calls: number } {
  const source = { calls: 0, read: () => { source.calls += 1; return answers[scenario](); } };
  return source;
}
