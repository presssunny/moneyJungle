import { prisma } from "../../config/database";
import { ApiError } from "../../utils/ApiError";
import { decimalToNumber, round2 } from "../../utils/money.utils";
import { parseLoanSchedule, ScheduleParseError, type ParsedSchedule } from "./loanSchedule.parser";

/**
 * Turns the bank's amortisation file into the loan itself, so the user never
 * types a balance, rate, payment count or end date the bank already stated.
 *
 * A loan is identified by `loanNumber` + `trackNumber`, so re-uploading a newer
 * export updates it in place rather than duplicating it. The file wins over a
 * simulation but never over reality: an older schedule cannot re-open a loan the
 * statement already closed.
 */

export interface ScheduleImportResult {
  loanId: number;
  /** True when this upload created the loan rather than updating one. */
  created: boolean;
  loanName: string;
  loanNumber: string | null;
  trackNumber: string | null;
  rowsStored: number;
  /** Hebrew summary of what the file said and what changed. */
  message: string;
  /** Facts pulled out of the file, for the confirmation panel. */
  parsed: ParsedSchedule;
  /**
   * Things the app cannot decide alone and must ask about (Assistant flow).
   * Empty when the file answered everything.
   */
  questions: Array<{ code: string; text: string }>;
}

function loanLabel(parsed: ParsedSchedule): string {
  if (parsed.loanNumber && parsed.trackNumber) {
    return `הלוואה ${parsed.loanNumber} · מסלול ${parsed.trackNumber}`;
  }
  if (parsed.loanNumber) return `הלוואה ${parsed.loanNumber}`;
  return parsed.trackName ?? "הלוואה מלוח סילוקין";
}

export const loanScheduleService = {
  /**
   * Read a schedule file and apply it. `loanId` forces the target when the user
   * answered "yes, this is that loan" to a matching question.
   */
  async importSchedule(
    userId: number,
    buffer: Buffer,
    loanId?: number
  ): Promise<ScheduleImportResult> {
    let parsed: ParsedSchedule;
    try {
      parsed = parseLoanSchedule(buffer);
    } catch (error) {
      if (error instanceof ScheduleParseError) throw ApiError.badRequest(error.message);
      throw error;
    }

    const questions: ScheduleImportResult["questions"] = [];

    // Find the loan this file belongs to. Explicit id first, then the bank's own
    // identifiers, so a second upload never creates a twin.
    let loan = loanId
      ? await prisma.loan.findFirst({ where: { id: loanId, userId } })
      : parsed.loanNumber
        ? await prisma.loan.findFirst({
            where: { userId, loanNumber: parsed.loanNumber, trackNumber: parsed.trackNumber },
          })
        : null;

    if (loanId && !loan) throw ApiError.notFound("ההלוואה לא נמצאה");

    const created = loan === null;
    const label = loanLabel(parsed);
    const name = parsed.trackName ?? label;

    // A schedule that starts mid-way cannot state the opening principal — it is
    // reconstructed, and the user is the only one who can turn it into a fact.
    if (parsed.originalAmountSource === "reconstructed") {
      questions.push({
        code: "original_amount",
        text:
          `הלוח מתחיל מתשלום ${parsed.paymentsMade + 1}, ולכן הסכום המקורי חושב לאחור ` +
          `(${parsed.originalAmount.toLocaleString("he-IL")} ₪ בקירוב). ` +
          `יש לך את הסכום המקורי לפי החוזה, או לוח מלא מתשלום 1?`,
      });
    }

    const shared = {
      loanNumber: parsed.loanNumber,
      trackNumber: parsed.trackNumber,
      trackName: parsed.trackName,
      currentBalance: parsed.currentBalance,
      annualInterestRate: parsed.annualInterestRate,
      monthlyPayment: parsed.monthlyPayment,
      endDate: new Date(parsed.expectedEndDate),
      totalPayments: parsed.totalPayments,
      paymentsMade: parsed.paymentsMade,
      scheduleSource: "bank_file",
      scheduleImportedAt: new Date(),
    };

    if (loan === null) {
      loan = await prisma.loan.create({
        data: {
          userId,
          loanName: name,
          loanType: "bank",
          originalAmount: parsed.originalAmount,
          originalAmountSource: parsed.originalAmountSource,
          // Without payment #1 the true start is unknown; the first listed
          // payment date is the closest honest anchor.
          startDate: new Date(parsed.nextPaymentDate),
          ...shared,
        },
      });
    } else {
      // A closed loan keeps its closure. An older export of a loan that has since
      // been paid off must not resurrect it as active (CLAUDE.md §2 — reality wins).
      const isClosed = loan.status === "finished";
      loan = await prisma.loan.update({
        where: { id: loan.id },
        data: {
          ...shared,
          ...(isClosed
            ? { currentBalance: loan.currentBalance, paymentsMade: loan.paymentsMade }
            : {}),
          // Never downgrade a contract figure the user confirmed to a guess.
          ...(loan.originalAmountSource === "contract"
            ? {}
            : {
                originalAmount: parsed.originalAmount,
                originalAmountSource: parsed.originalAmountSource,
              }),
        },
      });
      if (isClosed) {
        questions.push({
          code: "closed_loan_schedule",
          text: `ההלוואה הזו מסומנת כסגורה במערכת, אבל הלוח שהעלית עדיין מציג ${parsed.paymentsRemaining} תשלומים. עדכנתי את התנאים בלבד והשארתי אותה סגורה.`,
        });
      }
    }

    // Replace the schedule wholesale: a fresh export is the authority on every
    // row, and merging two vintages would leave rows from a superseded plan.
    await prisma.loanScheduleEntry.deleteMany({ where: { loanId: loan.id } });
    await prisma.loanScheduleEntry.createMany({
      data: parsed.rows.map((row) => ({
        loanId: loan!.id,
        paymentNumber: row.paymentNumber,
        paymentDate: new Date(row.paymentDate),
        principal: row.principal,
        interest: row.interest,
        total: row.total,
        balanceAfter: row.balanceAfter,
      })),
    });

    return {
      loanId: loan.id,
      created,
      loanName: loan.loanName,
      loanNumber: parsed.loanNumber,
      trackNumber: parsed.trackNumber,
      rowsStored: parsed.rows.length,
      parsed,
      questions,
      message: created
        ? `נוצרה ${label}: יתרה ${parsed.currentBalance.toLocaleString("he-IL")} ₪ · ` +
          `${parsed.paymentsRemaining} תשלומים של ${parsed.monthlyPayment.toLocaleString("he-IL")} ₪ · ` +
          `ריבית ${parsed.annualInterestRate}% · סיום ${parsed.expectedEndDate}`
        : `${label} עודכנה מהלוח: יתרה ${parsed.currentBalance.toLocaleString("he-IL")} ₪ · ` +
          `${parsed.paymentsMade} תשלומים בוצעו, ${parsed.paymentsRemaining} נותרו`,
    };
  },

  /**
   * The loan's schedule. Returns the bank's own rows when they exist; otherwise
   * simulates one and says so, so the UI can mark it as a scenario.
   */
  async getSchedule(userId: number, id: number) {
    const loan = await prisma.loan.findFirst({ where: { id, userId } });
    if (!loan) throw ApiError.notFound("ההלוואה לא נמצאה");

    const stored = await prisma.loanScheduleEntry.findMany({
      where: { loanId: id },
      orderBy: { paymentNumber: "asc" },
    });

    if (stored.length > 0) {
      const today = new Date();
      const rows = stored.map((row) => ({
        paymentNumber: row.paymentNumber,
        date: row.paymentDate.toISOString().slice(0, 10),
        principal: decimalToNumber(row.principal),
        interest: decimalToNumber(row.interest),
        total: decimalToNumber(row.total),
        balanceAfter: decimalToNumber(row.balanceAfter),
        status: row.paymentDate < today ? ("paid" as const) : ("future" as const),
      }));
      // The first payment still ahead is the one the user actually cares about.
      const next = rows.find((row) => row.status === "future");
      if (next) next.status = "next" as "future";

      return {
        source: "bank_file" as const,
        certainty: "measured" as const,
        rows,
        totals: {
          principal: round2(rows.reduce((sum, r) => sum + r.principal, 0)),
          interest: round2(rows.reduce((sum, r) => sum + r.interest, 0)),
        },
      };
    }

    // No file yet: fall back to the simulation the app has always used, but
    // labelled — an assumed schedule must never look like the bank's.
    const { amortizationSchedule } = await import("./loanCalculator.service");
    const simulated = amortizationSchedule({
      currentBalance: decimalToNumber(loan.currentBalance),
      annualInterestRate: decimalToNumber(loan.annualInterestRate),
      monthlyPayment: decimalToNumber(loan.monthlyPayment),
    });
    const start = new Date(loan.startDate);
    const rows = simulated.map((row) => {
      const date = new Date(start);
      date.setMonth(date.getMonth() + row.month);
      return {
        paymentNumber: row.month,
        date: date.toISOString().slice(0, 10),
        principal: row.principal,
        interest: row.interest,
        total: round2(row.principal + row.interest),
        balanceAfter: row.balance,
        status: (row.month === 1 ? "next" : "future") as "paid" | "next" | "future",
      };
    });

    return {
      source: "computed" as const,
      certainty: "scenario" as const,
      rows,
      totals: {
        principal: round2(rows.reduce((sum, r) => sum + r.principal, 0)),
        interest: round2(rows.reduce((sum, r) => sum + r.interest, 0)),
      },
    };
  },
};
