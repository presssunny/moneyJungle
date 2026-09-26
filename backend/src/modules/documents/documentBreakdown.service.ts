import { prisma } from "../../config/database";
import { ApiError } from "../../utils/ApiError";
import { decimalToNumber, round2 } from "../../utils/money.utils";
import { RESOLUTION_LABELS, type BankResolution } from "../bank/bankResolution";

export interface BreakdownLine {
  key: string;
  label: string;
  amount: number;
  count: number;
}

export interface DocumentBreakdown {
  documentId: number;
  fileName: string;
  kind: string;
  coverageFrom: string | null;
  coverageTo: string | null;
  /** False when the batch this file produced is gone (rolled back, or imported before lineage existed). */
  available: boolean;
  lines: BreakdownLine[];
  /** Interest net of interest credits (a credit is a negative financing expense, never income); null when the file has none to speak of. */
  interestNet: number | null;
  note: string | null;
}

const CREDIT_TYPE_LABELS: Record<string, string> = {
  regular: "עסקאות רגילות", standing_order: "הוראות קבע", credit: "זיכויים",
  refund: "החזרים", financing: "אשראי מתגלגל — מימון, לא הוצאה",
};

const day = (date: Date | null) => date?.toISOString().slice(0, 10) ?? null;

/**
 * What one uploaded file produced, grouped by the meaning each record already
 * carries — bank rows by resolution, card rows by transaction type, a schedule by
 * principal and interest. It reads stored records only and adds nothing up twice.
 */
export async function documentBreakdown(userId: number, id: number): Promise<DocumentBreakdown> {
  const doc = await prisma.document.findFirst({ where: { id, userId } });
  if (!doc) throw ApiError.notFound("המסמך לא נמצא");
  const base = { documentId: doc.id, fileName: doc.fileName, kind: doc.kind, coverageFrom: day(doc.coverageFrom), coverageTo: day(doc.coverageTo) };
  const unavailable = (note: string): DocumentBreakdown => ({ ...base, available: false, lines: [], interestNet: null, note });

  if (doc.kind === "bank_statement") {
    if (!doc.linkedStatementImportId) return unavailable("הדף הזה לא מקושר לתנועות שנקלטו ממנו");
    const groups = await prisma.bankTransaction.groupBy({
      by: ["resolution"], where: { userId, statementImportId: doc.linkedStatementImportId },
      _sum: { amount: true }, _count: { _all: true },
    });
    if (!groups.length) return unavailable("התנועות שנקלטו מהדף הזה כבר אינן קיימות");
    // Bank amounts are stored unsigned; the resolution carries the direction.
    const totalOf = (resolution: BankResolution) => decimalToNumber(groups.find((g) => g.resolution === resolution)?._sum.amount);
    const hasInterest = groups.some((g) => g.resolution === "financing_charge" || g.resolution === "financing_credit");
    return { ...base, available: true, note: null,
      interestNet: hasInterest ? round2(totalOf("financing_charge") - totalOf("financing_credit")) : null,
      lines: groups.map((g) => ({
      key: g.resolution ?? "unresolved",
      label: g.resolution ? RESOLUTION_LABELS[g.resolution as BankResolution] ?? g.resolution : "טרם סווג",
      amount: round2(decimalToNumber(g._sum.amount)), count: g._count._all,
    })) };
  }

  if (doc.kind === "credit_report") {
    if (!doc.linkedCreditImportId) return unavailable("הדוח הזה לא מקושר לעסקאות שנקלטו ממנו");
    const batch = await prisma.creditImport.findFirst({ where: { id: doc.linkedCreditImportId, userId }, select: { status: true } });
    if (!batch) return unavailable("העסקאות שנקלטו מהדוח הזה כבר אינן קיימות");
    const groups = await prisma.creditTransaction.groupBy({
      by: ["transactionType"], where: { userId, creditImportId: doc.linkedCreditImportId },
      _sum: { amount: true }, _count: { _all: true },
    });
    return { ...base, available: true, interestNet: null,
      note: batch.status === "confirmed" ? null : "הדוח טרם אושר, ולכן הסכומים עוד לא נספרים בהוצאות החודש",
      lines: groups.map((g) => ({ key: g.transactionType, label: CREDIT_TYPE_LABELS[g.transactionType] ?? g.transactionType,
        amount: round2(decimalToNumber(g._sum.amount)), count: g._count._all })) };
  }

  if (doc.kind === "loan_schedule") {
    if (!doc.linkedLoanId) return unavailable("הלוח הזה לא מקושר להלוואה");
    const sums = await prisma.loanScheduleEntry.aggregate({
      where: { loanId: doc.linkedLoanId, loan: { userId } }, _sum: { principal: true, interest: true }, _count: { _all: true },
    });
    if (!sums._count._all) return unavailable("שורות הלוח כבר אינן קיימות");
    return { ...base, available: true, interestNet: round2(decimalToNumber(sums._sum.interest)),
      note: "לוח סילוקין הוא תכנון: הריבית שבפועל נקבעת לפי דף הבנק", lines: [
      { key: "principal", label: "קרן לפי הלוח", amount: round2(decimalToNumber(sums._sum.principal)), count: sums._count._all },
      { key: "interest", label: "ריבית מתוכננת לפי הלוח", amount: round2(decimalToNumber(sums._sum.interest)), count: sums._count._all },
    ] };
  }

  return unavailable("לסוג הקובץ הזה אין פירוט לפי משמעות");
}
