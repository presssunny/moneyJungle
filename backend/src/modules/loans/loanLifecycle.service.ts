import { prisma } from "../../config/database";
import { Prisma } from "../../../generated/prisma/client";
import { decimalToNumber, round2 } from "../../utils/money.utils";

const PAYOFF_TOLERANCE = 1.0;

/** A fee posted within this many days of the payoff belongs to that closure. */
const FEE_WINDOW_DAYS = 3;

/** The line kinds a payoff can arrive on — what `syncFromStatement` closes by. */
const PAYOFF_LINE_KINDS = ["loan_principal", "loan_mixed"] as const;

/** A bank row as the reopen path needs to see it. */
export interface PayoffCandidate {
  id: number;
  lineKind: string;
  loanRef: string | null;
  amount: Prisma.Decimal | number;
  transactionDate: Date;
}

/** A closure to undo: which loan, and the balance the payoff row had cleared. */
export interface ReopenPlan {
  loanId: number;
  loanName: string;
  balance: number;
  /** Instalments actually made before the closure, counted off the schedule. */
  restoredPaymentsMade: number | null;
  /** No schedule to count and the closure had maxed the figure out — say unknown. */
  clearPaymentsMade: boolean;
}

/**
 * A closed loan on the same bank loan number as a row being deleted, with nothing
 * left proving what paid it off: no `autoClosedTransactionId`, or one pointing at
 * a row since deleted. Reported for the user to check, never reopened on a guess.
 */
export interface UnresolvedClosedLoan {
  loanName: string;
  loanNumber: string;
}

/**
 * The old closure wrote `paymentsMade` to `totalPayments`. Against a balance
 * owed again, that reads "0 payments left on a live debt" — so unknown instead.
 */
export function closureMaxedPaymentsMade(loan: {
  paymentsMade: number | null;
  totalPayments: number | null;
}): boolean {
  return loan.totalPayments !== null && loan.paymentsMade === loan.totalPayments;
}

/**
 * What "no longer closed" means, shared by the import-rollback and manual-edit
 * paths (CLAUDE.md §4). A maxed-out `paymentsMade` is cleared without a real count.
 */
export function reopenedLoanFields(input: {
  restoredPaymentsMade: number | null;
  clearPaymentsMade: boolean;
}): Prisma.LoanUncheckedUpdateInput {
  return {
    closedAt: null,
    closureReason: null,
    closureCost: null,
    // A live loan claiming to have been closed by a row is a claim nothing backs,
    // and the next sync reads this column.
    autoClosedTransactionId: null,
    ...(input.restoredPaymentsMade !== null
      ? { paymentsMade: input.restoredPaymentsMade }
      : input.clearPaymentsMade
        ? { paymentsMade: null }
        : {}),
  };
}

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
   * Re-derive every loan's lifecycle from the bank rows — safe to call after any
   * import, and repeatedly. Returns only events NEW to this run, so a closure is
   * celebrated once and not on every page load.
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

    // One row pays off one loan — two tracks sharing a number and balance would
    // otherwise both match it. Seeded from closures on record so a rerun can't reuse a row.
    const claimed = new Set<number>(
      loans
        .map((loan) => loan.autoClosedTransactionId)
        .filter((id): id is number => id !== null)
    );

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
        (row) =>
          !claimed.has(row.id) &&
          Math.abs(decimalToNumber(row.amount) - balance) <= PAYOFF_TOLERANCE
      );
      if (!payoff) continue;
      claimed.add(payoff.id);

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

      // `paymentsMade` stays as it was: an early payoff didn't make the remaining
      // instalments, and overwriting it would leave nothing to restore on undo.
      await prisma.loan.update({
        where: { id: loan.id },
        data: {
          status: "finished",
          currentBalance: 0,
          closedAt,
          closureReason: "early_repayment",
          closureCost: closureCost > 0 ? closureCost : null,
          // Written here because this is the only place that knows which row did
          // it — afterwards a sibling track can share the same number and amount.
          autoClosedTransactionId: payoff.id,
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
   * Closures `syncFromStatement` made on the strength of these rows, so a caller
   * about to delete them can undo them. Read-only — the caller reopens inside its
   * own transaction. Matched by `autoClosedTransactionId`; a closure with no
   * marker or a deleted one is reported as unresolved instead of guessed at.
   */
  async findClosedBy(
    userId: number,
    rows: PayoffCandidate[]
  ): Promise<{ plans: ReopenPlan[]; unresolved: UnresolvedClosedLoan[] }> {
    const kinds: readonly string[] = PAYOFF_LINE_KINDS;
    const payoffs = rows.filter(
      (row): row is PayoffCandidate & { loanRef: string } =>
        row.loanRef !== null && kinds.includes(row.lineKind)
    );
    if (payoffs.length === 0) return { plans: [], unresolved: [] };

    const byId = new Map(payoffs.map((row) => [row.id, row]));
    const loans = await prisma.loan.findMany({
      where: {
        userId,
        status: "finished",
        loanNumber: { in: [...new Set(payoffs.map((row) => row.loanRef))] },
      },
      select: {
        id: true,
        loanName: true,
        loanNumber: true,
        closedAt: true,
        paymentsMade: true,
        totalPayments: true,
        autoClosedTransactionId: true,
      },
    });

    // A marker outside this batch either points at a row in a surviving import
    // (closure stands) or a hand-deleted one (marker dangles) — one query tells them apart.
    const missedIds = loans
      .map((loan) => loan.autoClosedTransactionId)
      .filter((id): id is number => id !== null && !byId.has(id));
    const stillOnRecord = new Set(
      missedIds.length === 0
        ? []
        : (
            await prisma.bankTransaction.findMany({
              where: { userId, id: { in: missedIds } },
              select: { id: true },
            })
          ).map((row) => row.id)
    );

    const plans: ReopenPlan[] = [];
    const unresolved: UnresolvedClosedLoan[] = [];
    for (const loan of loans) {
      if (loan.autoClosedTransactionId === null) {
        // Closed by hand, or before this column existed — the balance may be
        // wrong, so report it rather than guess.
        if (loan.loanNumber !== null) {
          unresolved.push({ loanName: loan.loanName, loanNumber: loan.loanNumber });
        }
        continue;
      }
      const payoff = byId.get(loan.autoClosedTransactionId);
      if (!payoff) {
        // Closed by a row outside this batch. Still on record → that import
        // stands. Gone → the proof was deleted by hand, so report it unresolved.
        if (!stillOnRecord.has(loan.autoClosedTransactionId) && loan.loanNumber !== null) {
          unresolved.push({ loanName: loan.loanName, loanNumber: loan.loanNumber });
        }
        continue;
      }

      // Instalments made before the closure, counted off the bank's own schedule.
      const scheduled = await prisma.loanScheduleEntry.count({ where: { loanId: loan.id } });
      const restoredPaymentsMade =
        scheduled === 0 || loan.closedAt === null
          ? null
          : await prisma.loanScheduleEntry.count({
              where: { loanId: loan.id, paymentDate: { lt: loan.closedAt } },
            });

      plans.push({
        loanId: loan.id,
        loanName: loan.loanName,
        balance: decimalToNumber(payoff.amount),
        restoredPaymentsMade,
        clearPaymentsMade: closureMaxedPaymentsMade(loan),
      });
    }
    return { plans, unresolved };
  },

  /**
   * Undo an automatic closure: the debt is owed again. Runs on the caller's
   * transaction client so the reopen and the row deletion are atomic.
   */
  async reopen(db: Prisma.TransactionClient, plan: ReopenPlan): Promise<void> {
    await db.loan.update({
      where: { id: plan.loanId },
      data: {
        status: "active",
        currentBalance: plan.balance,
        ...reopenedLoanFields(plan),
      },
    });
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
        // Never a row: this closure is the user's own statement, and that is
        // exactly what keeps an import rollback from overruling it.
        autoClosedTransactionId: null,
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
