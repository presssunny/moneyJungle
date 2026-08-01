import { ApiError } from "../../utils/ApiError";
import { decimalToNumber, round2 } from "../../utils/money.utils";
import { reconciliationService } from "../bank/reconciliation.service";
import { computeLoan, loanProgress } from "./loanCalculator.service";
import { loanLifecycleService } from "./loanLifecycle.service";
import { loansRepository } from "./loans.repository";
import { CreateLoanBody, UpdateLoanBody } from "./loans.validation";

type LoanRecord = NonNullable<Awaited<ReturnType<typeof loansRepository.findById>>>;

/** Flatten decimals to numbers and attach derived Spitzer + lifecycle values. */
function serializeLoan(loan: LoanRecord) {
  const currentBalance = decimalToNumber(loan.currentBalance);
  const annualInterestRate = decimalToNumber(loan.annualInterestRate);
  const monthlyPayment = decimalToNumber(loan.monthlyPayment);
  const originalAmount = decimalToNumber(loan.originalAmount);

  return {
    ...loan,
    originalAmount,
    currentBalance,
    annualInterestRate,
    monthlyPayment,
    earlyRepaymentFee:
      loan.earlyRepaymentFee === null ? null : decimalToNumber(loan.earlyRepaymentFee),
    closureCost: loan.closureCost === null ? null : decimalToNumber(loan.closureCost),
    // Unchanged shape — five other modules depend on `computed` exactly as it is.
    computed: computeLoan({ currentBalance, annualInterestRate, monthlyPayment }),
    progress: loanProgress({
      status: loan.status,
      originalAmount,
      currentBalance,
      monthlyPayment,
      annualInterestRate,
      totalPayments: loan.totalPayments,
      paymentsMade: loan.paymentsMade,
      originalAmountSource: loan.originalAmountSource,
      scheduleSource: loan.scheduleSource,
    }),
  };
}

export type SerializedLoan = ReturnType<typeof serializeLoan>;

/**
 * The loans screen's summary. Every figure the screen shows is computed here and
 * only here — the UI renders it, never derives it (CLAUDE.md §4).
 */
function buildSummary(items: SerializedLoan[]) {
  const active = items.filter((loan) => loan.status !== "finished");
  const closed = items.filter((loan) => loan.status === "finished");

  return {
    activeCount: active.length,
    closedCount: closed.length,
    totalBalance: round2(active.reduce((sum, l) => sum + l.currentBalance, 0)),
    monthlyPayment: round2(active.reduce((sum, l) => sum + l.monthlyPayment, 0)),
    monthlyInterest: round2(active.reduce((sum, l) => sum + l.computed.monthlyInterestPayment, 0)),
    annualInterest: round2(active.reduce((sum, l) => sum + l.computed.estimatedAnnualInterest, 0)),
    /**
     * Repayment that closing loans has freed up — the achievement card. It is the
     * monthly instalment those loans no longer take, which is exactly the money
     * that became available again.
     */
    freedMonthlyPayment: round2(closed.reduce((sum, l) => sum + l.monthlyPayment, 0)),
    /** What closing early cost in fees, so the saving is never shown gross. */
    closureCosts: round2(closed.reduce((sum, l) => sum + (l.closureCost ?? 0), 0)),
    endingSoonCount: active.filter((l) => l.progress.lifecycle === "ending_soon").length,
    /**
     * True when any active loan's progress rests on a reconstructed opening
     * amount, so the screen can mark its totals as a scenario (IA §1.2).
     */
    hasScenarioProgress: active.some((l) => l.progress.certainty === "scenario"),
  };
}

/**
 * Tracks of the same bank loan, grouped for display only.
 *
 * Grouping happens here rather than as a parent row in the database on purpose:
 * an aggregate `loans` record would be summed by `findActive()` in dashboard,
 * insights, alerts, updates and cashflow, and every one of them would
 * double-count it.
 */
function groupByLoanNumber(items: SerializedLoan[]) {
  const groups = new Map<string, { loanNumber: string; tracks: SerializedLoan[] }>();
  for (const loan of items) {
    if (!loan.loanNumber) continue;
    const group = groups.get(loan.loanNumber) ?? { loanNumber: loan.loanNumber, tracks: [] };
    group.tracks.push(loan);
    groups.set(loan.loanNumber, group);
  }
  return [...groups.values()]
    .filter((group) => group.tracks.length > 1)
    .map((group) => ({
      loanNumber: group.loanNumber,
      trackIds: group.tracks.map((t) => t.id),
      totalBalance: round2(
        group.tracks
          .filter((t) => t.status !== "finished")
          .reduce((sum, t) => sum + t.currentBalance, 0)
      ),
      activeTracks: group.tracks.filter((t) => t.status !== "finished").length,
      closedTracks: group.tracks.filter((t) => t.status === "finished").length,
    }));
}

export const loansService = {
  async list(userId: number) {
    // Reality first: a payoff sitting in an imported statement closes the loan
    // before the screen is drawn, so the numbers are never a step behind.
    const events = await loanLifecycleService.syncFromStatement(userId);

    const loans = await loansRepository.findAll(userId);
    const items = loans.map(serializeLoan);
    const summary = buildSummary(items);

    // What the bank statement itself reports about loans. A loan the user never
    // entered still has real repayments in the account, and principal is debt
    // reduction rather than spending — this is where that money is accounted for
    // instead of sitting outside every figure.
    const fromStatement = await reconciliationService.loanActivityFromStatement(userId);

    return {
      loans: items,
      summary,
      groups: groupByLoanNumber(items),
      /** Closures detected during this call — the UI celebrates these once. */
      events,
      fromStatement,
      // Kept for the existing consumers (AccountsPage net-worth strip) so this
      // response stays backwards compatible.
      totals: {
        totalBalance: summary.totalBalance,
        monthlyPayment: summary.monthlyPayment,
        monthlyInterest: summary.monthlyInterest,
        annualInterest: summary.annualInterest,
        activeCount: summary.activeCount,
      },
    };
  },

  create(userId: number, body: CreateLoanBody) {
    return loansRepository
      .create(userId, {
        loanName: body.loanName,
        loanType: body.loanType,
        lenderName: body.lenderName ?? null,
        originalAmount: body.originalAmount,
        currentBalance: body.currentBalance,
        annualInterestRate: body.annualInterestRate,
        monthlyPayment: body.monthlyPayment,
        startDate: body.startDate,
        endDate: body.endDate ?? null,
        isIndexLinked: body.isIndexLinked ?? false,
        earlyRepaymentFee: body.earlyRepaymentFee ?? null,
        status: body.status ?? "active",
        loanNumber: body.loanNumber ?? null,
        trackNumber: body.trackNumber ?? null,
        // A hand-entered opening amount is a stated fact, not a reconstruction.
        originalAmountSource: "contract",
      })
      .then(serializeLoan);
  },

  async update(userId: number, id: number, body: UpdateLoanBody) {
    const existing = await loansRepository.findById(userId, id);
    if (!existing) throw ApiError.notFound("ההלוואה לא נמצאה");
    // Stating the contract amount upgrades the progress figures from a
    // reconstructed scenario to a measured one.
    const data =
      body.originalAmount !== undefined
        ? { ...body, originalAmountSource: "contract" }
        : body;
    return loansRepository.update(id, data).then(serializeLoan);
  },

  async remove(userId: number, id: number) {
    const existing = await loansRepository.findById(userId, id);
    if (!existing) throw ApiError.notFound("ההלוואה לא נמצאה");
    // A closed loan is the record of an achievement and of the repayment that was
    // freed up. Deleting it would erase both, so it is refused outright.
    if (existing.status === "finished") {
      throw ApiError.badRequest(
        "אי אפשר למחוק הלוואה שנסגרה — היא ההיסטוריה של מה שכבר נפרע. אפשר להסתיר הלוואות סגורות במסך."
      );
    }
    await loansRepository.delete(id);
  },

  /** Close a loan by hand and report what it freed up. */
  async close(
    userId: number,
    id: number,
    body: { closedAt: Date; reason: string; closureCost?: number | null }
  ) {
    const existing = await loansRepository.findById(userId, id);
    if (!existing) throw ApiError.notFound("ההלוואה לא נמצאה");
    if (existing.status === "finished") throw ApiError.badRequest("ההלוואה כבר סגורה");

    const event = await loanLifecycleService.close(id, {
      closedAt: body.closedAt,
      reason: body.reason,
      closureCost: body.closureCost ?? null,
    });
    const loan = await loansRepository.findById(userId, id);
    return { event, loan: loan ? serializeLoan(loan) : null };
  },

  /** What paying this loan off today would cost and save. Changes nothing. */
  async earlyRepaymentQuote(userId: number, id: number) {
    const quote = await loanLifecycleService.earlyRepaymentQuote(userId, id);
    if (!quote) throw ApiError.notFound("ההלוואה לא נמצאה");
    return quote;
  },
};
