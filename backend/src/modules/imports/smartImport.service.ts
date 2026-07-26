import { prisma } from "../../config/database";
import { ApiError } from "../../utils/ApiError";
import { bankService } from "../bank/bank.service";
import { creditService } from "../credit/credit.service";
import { detectStatement, type StatementKind } from "./statementDetector.service";

/**
 * One upload point for statements.
 *
 * The user has a file, not a category — asking her to pick "bank" or "credit"
 * before the app has even looked at it puts the burden of classification on the
 * person who has the least information. This service reads the file, decides
 * what it is, sends it to the matching importer, and reports back in one shape:
 * what it detected, what went in, and what was already there.
 *
 * Nothing is imported when detection is unsure — a bank statement parsed as a
 * card statement produces silent nonsense, which is worse than a question.
 */
export interface SmartImportResult {
  kind: StatementKind;
  detectionReason: string;
  matchedSignals: string[];
  fileName: string;
  /** Rows the file contained, and how they were split. */
  parsedRows: number;
  importedRows: number;
  skippedDuplicates: number;
  /** True when the file added nothing — every row was already stored. */
  alreadyImported: boolean;
  /** Hebrew one-liner the UI shows as the headline outcome. */
  message: string;
  /** Set for credit files, so the UI can jump to the pending import. */
  creditImportId?: number;
  /** Set for bank files: bank rows land straight in the account. */
  bankAccountId?: number;
}

function describe(kind: StatementKind): string {
  if (kind === "bank") return "דף חשבון בנק";
  if (kind === "credit") return "דוח כרטיס אשראי";
  return "קובץ לא מזוהה";
}

export const smartImportService = {
  /**
   * @param forcedKind set only when the user overrides a detection she disagrees
   *   with; detection is otherwise the sole decider.
   */
  async importFile(
    userId: number,
    fileName: string,
    buffer: Buffer,
    forcedKind?: StatementKind
  ): Promise<SmartImportResult> {
    const detection = detectStatement(buffer, fileName);
    const kind = forcedKind ?? detection.kind;

    if (kind === "unknown") {
      throw ApiError.badRequest(
        `${detection.reason}. אפשר לבחור ידנית אם זה דף חשבון או דוח אשראי ולנסות שוב.`
      );
    }

    const base = {
      kind,
      detectionReason: forcedKind ? `נבחר ידנית: ${describe(kind)}` : detection.reason,
      matchedSignals: detection.matchedSignals,
      fileName,
    };

    if (kind === "credit") {
      const result = await creditService.createImport(userId, fileName, buffer);
      if (result.alreadyImported) {
        return {
          ...base,
          parsedRows: result.parsedRows,
          importedRows: 0,
          skippedDuplicates: result.skippedDuplicates,
          alreadyImported: true,
          message: result.previousImport
            ? `הדוח הזה כבר הועלה (${result.previousImport.fileName}) — לא נוספה אף עסקה`
            : `כל ${result.parsedRows} העסקאות בקובץ כבר קיימות — לא נוסף כלום`,
        };
      }
      return {
        ...base,
        parsedRows: result.parsedRows,
        importedRows: result.totalTransactions,
        skippedDuplicates: result.skippedDuplicates,
        alreadyImported: false,
        creditImportId: result.id,
        message:
          result.skippedDuplicates > 0
            ? `נוספו ${result.totalTransactions} עסקאות חדשות; ${result.skippedDuplicates} כבר היו קיימות`
            : `נוספו ${result.totalTransactions} עסקאות — ממתינות לאישורך`,
      };
    }

    // Bank: rows attach to an account. With a single account the choice is not
    // a real question, so it is not asked.
    const accounts = await prisma.bankAccount.findMany({
      where: { userId },
      orderBy: { id: "asc" },
      select: { id: true, accountName: true },
    });
    if (accounts.length === 0) {
      throw ApiError.badRequest("אין חשבון בנק במערכת — צרי חשבון בטאב הבנק ואז ייבאי את הדוח");
    }
    if (accounts.length > 1) {
      throw ApiError.badRequest(
        "יש יותר מחשבון בנק אחד — ייבאי את הדוח מתוך החשבון המבוקש בטאב הבנק"
      );
    }
    const account = accounts[0]!;
    const result = await bankService.importStatement(userId, account.id, buffer, fileName);
    const auto = result.autoReconciled;
    // Rows that reached a money figure: income, ordinary spend, interest both ways
    // and card bills nothing else itemizes. Loan principal and settled card bills
    // are resolved too, but on purpose they belong to no expense figure.
    const promoted = auto
      ? auto.income.count +
        auto.spend.count +
        auto.financingCharged.count +
        auto.financingCredited.count +
        auto.cardUnitemized.count
      : 0;
    return {
      ...base,
      parsedRows: result.parsed,
      importedRows: result.imported,
      skippedDuplicates: result.skippedDuplicates,
      alreadyImported: result.imported === 0 && result.parsed > 0,
      bankAccountId: account.id,
      message:
        result.imported === 0
          ? `הדוח הזה כבר הועלה — כל ${result.parsed} התנועות כבר קיימות`
          : result.skippedDuplicates > 0
            ? `נוספו ${result.imported} תנועות חדשות (${result.skippedDuplicates} כבר היו קיימות), ${promoted} נכנסו לסכומים`
            : `נוספו ${result.imported} תנועות, ${promoted} נכנסו לסכומים`,
    };
  },
};
