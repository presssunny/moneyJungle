import { prisma } from "../../config/database";
import { decimalToNumber, round2 } from "../../utils/money.utils";

/**
 * Moves loans through their life from the statement. The schedule says what was
 * planned; only the statement says what happened, so a loan paid off early still
 * shows future payments until a posted principal row clears its balance — then
 * it is marked finished with the date, reason, fees and what the closure saved.
 *
 * Idempotent by construction, like `resolveAll()`: state is derived from the
 * rows, so importing the same statement twice cannot close a loan twice.
 */

/** How close a principal payment must be to the balance to count as a payoff. */
const PAYOFF_TOLERANCE = 1.0;

/** A fee posted within this many days of the payoff belongs to that closure. */
const FEE_WINDOW_DAYS = 3;

export interface LoanEvent {
  type: "loan_closed" | "payments_advanced";
  loanId: number;
  loanName: string;
  loanNumber: string | null;
  trackNumber: string | null;
  /** ISO date of the event. */
  date: string;
  /** Monthly repayment that is now free. The headline of the celebration. */
  freedMonthlyPayment: number;
  /** Future interest the early payoff avoided — from the schedule, so exact. */
  savedInterest: number;
  /** Fees the bank charged for closing early. */
  closureCost: number;
  /** Hebrew sentence for the success message. */
  message: string;
}

export const loanLifecycleService = {
  /**
   * Re-derive every loan's lifecycle from the bank rows. Safe to call after any
   * import (statement or schedule) and safe to call repeatedly.
   *
   * Returns only the events that are NEW to this run, so the UI can celebrate a
   * closure once instead of on every page load.
   */
  async syncFromStatement(userId: number): Promise<LoanEvent[]> {
    const loans = await prisma.loan.findMany({ where: { userId } });
    if (loans.length === 0) return [];

    // Principal rows the bank posted, newest last. `loanRef` is what ties a row
    // to a loan — which is exactly why the parser had to stop discarding it on
    // principal lines.
    const principalRows = await prisma.bankTransaction.findMany({
      where: {
        userId,
        type: "withdrawal",
        lineKind: { in: ["loan_principal", "loan_mixed"] },
      },
      orderBy: [{ transactionDate: "asc" }, { id: "asc" }],
      select: { id: true, transactionDate: true, amount: true, loanRef: true, lineKind: true },
    });

    const feeRows = await prisma.bankTransaction.findMany({
      where: { userId, lineKind: "loan_fee", type: "withdrawal" },
      select: { transactionDate: true, amount: true, loanRef: true },
    });

    const events: LoanEvent[] = [];

    for (const loan of loans) {
      if (loan.status === "finished") continue; // already closed — nothing to re-derive
      const balance = decimalToNumber(loan.currentBalance);
      if (balance <= 0.005) continue;

      // Only rows that name this loan. A row with no number cannot be attributed
      // to one of several loans, and guessing would close the wrong one.
      const ref = loan.loanNumber;
      if (!ref) continue;
      const rows = principalRows.filter((row) => row.loanRef === ref);

      const payoff = rows.find(
        (row) => Math.abs(decimalToNumber(row.amount) - balance) <= PAYOFF_TOLERANCE
      );
      if (!payoff) continue;

      // Fees posted around the payoff date are the cost of closing.
      const payoffTime = payoff.transactionDate.getTime();
      const windowMs = FEE_WINDOW_DAYS * 24 * 60 * 60 * 1000;
      const closureCost = round2(
        feeRows
          .filter((fee) => Math.abs(fee.transactionDate.getTime() - payoffTime) <= windowMs)
          .reduce((sum, fee) => sum + decimalToNumber(fee.amount), 0)
      );

      // Interest the payoff avoided: the remaining schedule's own interest column
      // from the payoff date onward. Taken from the bank's file, so it is a real
      // figure — not a projection. Without a schedule we say nothing (never 0).
      const futureInterest = await prisma.loanScheduleEntry.aggregate({
        where: { loanId: loan.id, paymentDate: { gte: payoff.transactionDate } },
        _sum: { interest: true },
      });
      const savedInterest = round2(decimalToNumber(futureInterest._sum.interest));
      const freedMonthlyPayment = decimalToNumber(loan.monthlyPayment);
      const closedAt = payoff.transactionDate;

      await prisma.loan.update({
        where: { id: loan.id },
        data: {
          status: "finished",
          currentBalance: 0,
          closedAt,
          closureReason: "early_repayment",
          closureCost: closureCost > 0 ? closureCost : null,
          paymentsMade: loan.totalPayments ?? loan.paymentsMade,
        },
      });

      const savedText =
        savedInterest > 0
          ? ` נחסכה ריבית עתידית של ${savedInterest.toLocaleString("he-IL")} ₪.`
          : "";
      events.push({
        type: "loan_closed",
        loanId: loan.id,
        loanName: loan.loanName,
        loanNumber: loan.loanNumber,
        trackNumber: loan.trackNumber,
        date: closedAt.toISOString().slice(0, 10),
        freedMonthlyPayment,
        savedInterest,
        closureCost,
        message:
          `ההלוואה "${loan.loanName}" נסגרה בפירעון מוקדם. ` +
          `${freedMonthlyPayment.toLocaleString("he-IL")} ₪ בחודש התפנו.${savedText}`,
      });
    }

    return events;
  },

  /**
   * Close a loan by hand — for a payoff that never reached a statement, or one
   * the app could not attribute. Same end state as the automatic path.
   */
  async close(
    loanId: number,
    input: { closedAt: Date; reason: string; closureCost: number | null }
  ): Promise<LoanEvent> {
    const loan = await prisma.loan.findUniqueOrThrow({ where: { id: loanId } });

    const futureInterest = await prisma.loanScheduleEntry.aggregate({
      where: { loanId, paymentDate: { gte: input.closedAt } },
      _sum: { interest: true },
    });
    const savedInterest = round2(decimalToNumber(futureInterest._sum.interest));
    const freedMonthlyPayment = decimalToNumber(loan.monthlyPayment);

    await prisma.loan.update({
      where: { id: loanId },
      data: {
        status: "finished",
        currentBalance: 0,
        closedAt: input.closedAt,
        closureReason: input.reason,
        closureCost: input.closureCost,
        paymentsMade: loan.totalPayments ?? loan.paymentsMade,
      },
    });

    return {
      type: "loan_closed",
      loanId,
      loanName: loan.loanName,
      loanNumber: loan.loanNumber,
      trackNumber: loan.trackNumber,
      date: input.closedAt.toISOString().slice(0, 10),
      freedMonthlyPayment,
      savedInterest,
      closureCost: input.closureCost ?? 0,
      message:
        `ההלוואה "${loan.loanName}" נסגרה. ` +
        `${freedMonthlyPayment.toLocaleString("he-IL")} ₪ בחודש התפנו.`,
    };
  },

  /**
   * What an early payoff would cost and save if done today. Read-only — it
   * changes nothing, so the user can look before deciding.
   */
  async earlyRepaymentQuote(userId: number, loanId: number) {
    const loan = await prisma.loan.findFirst({ where: { id: loanId, userId } });
    if (!loan) return null;

    const today = new Date();
    const remaining = await prisma.loanScheduleEntry.aggregate({
      where: { loanId, paymentDate: { gte: today } },
      _sum: { interest: true, total: true },
      _count: true,
    });

    const balance = decimalToNumber(loan.currentBalance);
    const fee = decimalToNumber(loan.earlyRepaymentFee);
    const savedInterest = round2(decimalToNumber(remaining._sum.interest));

    return {
      currentBalance: balance,
      estimatedFee: fee,
      payoffToday: round2(balance + fee),
      savedInterest,
      /** Net gain: interest avoided minus the fee for avoiding it. */
      netSaving: round2(savedInterest - fee),
      remainingPayments: remaining._count,
      remainingTotal: round2(decimalToNumber(remaining._sum.total)),
      /** No schedule → no honest interest figure. Say so, never show 0. */
      hasSchedule: remaining._count > 0,
    };
  },
};
