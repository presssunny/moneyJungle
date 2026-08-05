import { prisma } from "../../config/database";
import { ApiError } from "../../utils/ApiError";
import {
  answerOf,
  type AssistantAnswers,
  type AssistantFact,
  type AssistantQuestion,
  type AssistantStep,
} from "../assistant/assistant.types";
import { bankService } from "../bank/bank.service";
import { documentsService } from "../documents/documents.service";
import { creditService } from "../credit/credit.service";
import { detectStatement, type StatementKind } from "./statementDetector.service";

/**
 * One upload point: reads the file, decides bank or card, routes it and reports
 * what it found. The user has a file, not a category. Unsure means nothing is
 * imported — silent nonsense is worse than a question.
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
  /**
   * The conversation. `status: "needs_answers"` means NOTHING was imported and
   * the client should re-send the same file together with `answers`.
   */
  assistant: AssistantStep;
}

/** A step that could not finish. Nothing has been written when this is returned. */
function ask(
  fileName: string,
  says: string[],
  facts: AssistantFact[],
  questions: AssistantQuestion[]
): SmartImportResult {
  return {
    kind: "unknown",
    detectionReason: says[says.length - 1] ?? "",
    matchedSignals: [],
    fileName,
    parsedRows: 0,
    importedRows: 0,
    skippedDuplicates: 0,
    alreadyImported: false,
    message: questions[0]?.text ?? "",
    assistant: { status: "needs_answers", says, facts, questions },
  };
}

/** The kinds a user can pick between; also what an answer is validated against. */
const FORCED_KINDS: readonly StatementKind[] = ["bank", "credit"];

function describe(kind: StatementKind): string {
  if (kind === "bank") return "דף חשבון בנק";
  if (kind === "credit") return "דוח כרטיס אשראי";
  if (kind === "loan_schedule") return "לוח סילוקין של הלוואה";
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
    forcedKind?: StatementKind,
    answers?: AssistantAnswers
  ): Promise<SmartImportResult> {
    // Recorded once the outcome is known — see `record` below.
    const fileSize = buffer.byteLength;
    const detection = detectStatement(buffer, fileName);
    // An answered question outranks detection: the user has the file in front of
    // her and the app does not.
    const answeredKind = FORCED_KINDS.find((k) => k === answerOf(answers, "file_kind"));
    const kind = answeredKind ?? forcedKind ?? detection.kind;

    const says = [`קיבלתי את הקובץ "${fileName}".`];

    if (kind === "unknown") {
      // Everything the detector DID work out, so the choice is informed rather
      // than a coin toss — this is exactly what the old 400 threw away.
      says.push(detection.reason);
      const facts: AssistantFact[] = [];
      if (detection.matchedSignals.length > 0) {
        facts.push({ label: "כותרות שזוהו", value: detection.matchedSignals.join(", ") });
      }
      if (detection.bankScore > 0 || detection.creditScore > 0) {
        facts.push({
          label: "ניקוד",
          value: `דף חשבון ${detection.bankScore} · דוח אשראי ${detection.creditScore}`,
        });
      }
      return ask(fileName, says, facts, [
        {
          code: "file_kind",
          text:
            detection.bankScore === detection.creditScore && detection.bankScore > 0
              ? "הקובץ נראה גם כדף חשבון וגם כדוח אשראי. מה הוא באמת?"
              : "לא הצלחתי לזהות מה הקובץ הזה. תעזרי לי?",
          kind: "choice",
          options: [
            { value: "bank", label: "דף חשבון בנק", hint: "יתרה, זכות/חובה, תאריך ערך" },
            { value: "credit", label: "דוח כרטיס אשראי", hint: "בית עסק, מועד חיוב, סוג עסקה" },
          ],
        },
      ]);
    }

    // A schedule reached the statement importer only because the detector used
    // to mis-read it. It has its own home, so route the user there instead of
    // parsing it as transactions.
    if (kind === "loan_schedule") {
      await documentsService.record(userId, {
        fileName,
        fileHash: detection.fileHash,
        sizeBytes: fileSize,
        kind: "loan_schedule",
        status: "rejected",
        detection: { reason: detection.reason, signals: detection.matchedSignals },
        note: "לוח סילוקין — יש להעלות אותו במסך ההלוואות",
      });
      return {
        kind: "loan_schedule",
        detectionReason: detection.reason,
        matchedSignals: detection.matchedSignals,
        fileName,
        parsedRows: 0,
        importedRows: 0,
        skippedDuplicates: 0,
        alreadyImported: false,
        message: "זהו לוח סילוקין של הלוואה, לא דוח תנועות",
        assistant: {
          status: "info",
          says: [
            ...says,
            detection.reason,
            "זה לא דוח תנועות אלא לוח סילוקין — הוא שייך למסך ההלוואות, ושם הוא גם יעדכן את ההלוואה לבד.",
          ],
          facts: [{ label: "סימנים שזוהו", value: detection.matchedSignals.join(", ") }],
          questions: [],
        },
      };
    }

    says.push(answeredKind ? `הבנתי — ${describe(kind)}.` : detection.reason);

    const base = {
      kind,
      detectionReason: forcedKind ? `נבחר ידנית: ${describe(kind)}` : detection.reason,
      matchedSignals: detection.matchedSignals,
      fileName,
    };

    if (kind === "credit") {
      const result = await creditService.createImport(userId, fileName, buffer);
      if (result.alreadyImported) {
        await documentsService.record(userId, {
          fileName,
          fileHash: detection.fileHash,
          sizeBytes: fileSize,
          kind: "credit_report",
          status: "superseded",
          rowsParsed: result.parsedRows,
          rowsSkipped: result.skippedDuplicates,
          detection: { reason: detection.reason, signals: detection.matchedSignals },
          note: "כל העסקאות כבר היו קיימות",
        });
        return {
          ...base,
          parsedRows: result.parsedRows,
          importedRows: 0,
          skippedDuplicates: result.skippedDuplicates,
          alreadyImported: true,
          message: result.previousImport
            ? `הדוח הזה כבר הועלה (${result.previousImport.fileName}) — לא נוספה אף עסקה`
            : `כל ${result.parsedRows} העסקאות בקובץ כבר קיימות — לא נוסף כלום`,
          assistant: {
            status: "info",
            says: [
              ...says,
              `קראתי ${result.parsedRows} עסקאות.`,
              result.previousImport
                ? `כולן כבר קיימות — הקובץ הזה כבר הועלה בשם "${result.previousImport.fileName}".`
                : "כולן כבר קיימות במערכת, אז לא הוספתי כלום.",
            ],
            facts: [{ label: "עסקאות בקובץ", value: String(result.parsedRows) }],
            questions: [],
          },
        };
      }
      await documentsService.record(userId, {
        fileName,
        fileHash: detection.fileHash,
        sizeBytes: fileSize,
        kind: "credit_report",
        linkedCreditImportId: result.id,
        rowsParsed: result.parsedRows,
        rowsImported: result.totalTransactions,
        rowsSkipped: result.skippedDuplicates,
        detection: { reason: detection.reason, signals: detection.matchedSignals },
      });
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
        assistant: {
          status: "done",
          says: [
            ...says,
            `קראתי ${result.parsedRows} עסקאות.`,
            result.skippedDuplicates > 0
              ? `${result.totalTransactions} חדשות נוספו, ${result.skippedDuplicates} כבר היו קיימות.`
              : `הוספתי ${result.totalTransactions} עסקאות.`,
            "הן ממתינות לאישורך לפני שייכנסו לסכומי החודש.",
          ],
          facts: [
            { label: "עסקאות בקובץ", value: String(result.parsedRows) },
            { label: "נוספו", value: String(result.totalTransactions) },
            { label: "דולגו ככפילות", value: String(result.skippedDuplicates) },
          ],
          questions: [],
        },
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
      // Nothing to ask here — there is no choice to make, only a missing step.
      // It stays an error, but one that says exactly what to do next.
      throw ApiError.badRequest("אין חשבון בנק במערכת — צרי חשבון בטאב הבנק ואז ייבאי את הדוח");
    }

    // Several accounts: the app genuinely cannot know which one the statement
    // belongs to, so it asks rather than refusing the whole import.
    const answeredAccount = Number(answerOf(answers, "bank_account"));
    const chosen =
      accounts.length === 1
        ? accounts[0]!
        : accounts.find((a) => a.id === answeredAccount);

    if (!chosen) {
      return ask(
        fileName,
        [...says, `יש ${accounts.length} חשבונות בנק במערכת, ואני לא יודע לאיזה מהם הדוח שייך.`],
        [],
        [
          {
            code: "bank_account",
            text: "לאיזה חשבון לשייך את הדוח?",
            kind: "choice",
            options: accounts.map((a) => ({ value: String(a.id), label: a.accountName })),
          },
        ]
      );
    }
    const account = chosen;
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
    await documentsService.record(userId, {
      fileName,
      fileHash: detection.fileHash,
      sizeBytes: fileSize,
      kind: "bank_statement",
      status: result.imported === 0 && result.parsed > 0 ? "superseded" : "imported",
      linkedAccountId: account.id,
      // The parser reports coverage as ISO strings on its own report.
      coverageFrom: result.report.coverageFrom ? new Date(result.report.coverageFrom) : null,
      coverageTo: result.report.coverageTo ? new Date(result.report.coverageTo) : null,
      rowsParsed: result.parsed,
      rowsImported: result.imported,
      rowsSkipped: result.skippedDuplicates,
      detection: { reason: detection.reason, signals: detection.matchedSignals },
    });
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
      assistant: {
        status: result.imported === 0 ? "info" : "done",
        says: [
          ...says,
          `קראתי ${result.parsed} תנועות מהדוח.`,
          // Overlap is normal, not an error — statements are downloaded in
          // overlapping ranges all the time. Saying so stops it looking like a
          // failure and explains why the count is lower than the file's.
          result.skippedDuplicates > 0
            ? `${result.skippedDuplicates} מהן כבר היו קיימות — הדוח חופף לתקופה שכבר יובאה, אז הוספתי רק את החדשות.`
            : "אף אחת מהן לא הייתה קיימת קודם.",
          result.imported === 0
            ? "לא נוסף כלום, אז שום סכום לא השתנה."
            : `הוספתי ${result.imported} תנועות, ${promoted} מהן נכנסו לסכומי הכסף.`,
        ],
        facts: [
          { label: "חשבון", value: account.accountName },
          { label: "תנועות בקובץ", value: String(result.parsed) },
          { label: "נוספו", value: String(result.imported) },
          { label: "דולגו ככפילות", value: String(result.skippedDuplicates) },
        ],
        questions: [],
      },
    };
  },
};
