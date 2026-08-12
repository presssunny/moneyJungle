import { prisma } from "../../config/database";
import { ApiError } from "../../utils/ApiError";
import { accountBalanceService } from "../bank/accountBalance.service";
import { reconciliationService } from "../bank/reconciliation.service";
import { loanLifecycleService } from "../loans/loanLifecycle.service";
import { documentStorage } from "./documentStorage.service";

/**
 * The record of every uploaded file and what came of it. Recording is best-effort:
 * a successful import must never be reported as failed because the log row wasn't.
 */

export type DocumentKind =
  | "bank_statement"
  | "credit_report"
  | "loan_schedule"
  | "expense_sheet"
  | "unknown";

export type DocumentStatus = "imported" | "rejected" | "superseded" | "rolled_back";

/**
 * Kinds that own a batch row naming exactly which transactions came from the
 * file. A loan schedule re-imports by upsert and an expense sheet has no batch
 * entity, so neither can be undone this way.
 */
const ROLLBACK_KINDS: readonly DocumentKind[] = ["bank_statement", "credit_report"];

export interface RecordDocumentInput {
  fileName: string;
  fileHash: string;
  sizeBytes: number;
  kind: DocumentKind;
  status?: DocumentStatus;
  coverageFrom?: Date | null;
  coverageTo?: Date | null;
  linkedLoanId?: number | null;
  linkedAccountId?: number | null;
  linkedCreditImportId?: number | null;
  linkedStatementImportId?: number | null;
  rowsParsed?: number;
  rowsImported?: number;
  rowsSkipped?: number;
  detection?: unknown;
  note?: string | null;
  /** The uploaded bytes. Kept on disk when given; metadata-only when omitted. */
  buffer?: Buffer;
}

const KIND_LABELS: Record<DocumentKind, string> = {
  bank_statement: "דף חשבון בנק",
  credit_report: "דוח כרטיס אשראי",
  loan_schedule: "לוח סילוקין",
  expense_sheet: "גיליון הוצאות",
  unknown: "לא זוהה",
};

export interface RollbackResult {
  kind: DocumentKind;
  removedTransactions: number;
  removedIncomes: number;
  removedExpenses: number;
  /** Rows the user had excluded by hand — detached from the batch, never deleted. */
  keptManual: number;
  /** Rows she tied to a loan by hand — same treatment, same reason. */
  keptLinked: number;
  /** Closures the deleted rows had caused, undone with the balance they cleared. */
  reopenedLoans: Array<{ loanName: string; balance: number }>;
  /**
   * Closed loans on the same bank loan number as a deleted row, with no record of
   * which row closed them — closed by hand, or before the app tracked it. Named
   * for the user to check rather than reopened on a guessed balance.
   */
  unresolvedClosedLoans: Array<{ loanName: string; loanNumber: string }>;
  /**
   * Other files covering the same days, whose overlapping rows were deduped into
   * THIS batch and leave with it — that file no longer covers those days.
   */
  overlappingImports: Array<{ fileName: string; coverageFrom: string; coverageTo: string }>;
  message: string;
}

const iso = (date: Date): string => date.toISOString().slice(0, 10);

function contentTypeOf(fileName: string): string {
  const name = fileName.toLowerCase();
  if (name.endsWith(".pdf")) return "application/pdf";
  if (name.endsWith(".xlsx")) {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  if (name.endsWith(".xls")) return "application/vnd.ms-excel";
  if (name.endsWith(".csv")) return "text/csv";
  return "application/octet-stream";
}

/**
 * Deleting the CreditImport cascades to its transactions; nothing else was ever
 * written since the expenses view merges credit at read time (CLAUDE.md §4).
 */
async function rollbackCreditReport(
  userId: number,
  documentId: number,
  creditImportId: number | null
): Promise<RollbackResult> {
  if (creditImportId === null) {
    throw ApiError.badRequest("למסמך הזה אין קישור לייבוא אשראי — אי אפשר לבטל אותו אוטומטית");
  }
  const creditImport = await prisma.creditImport.findFirst({
    where: { id: creditImportId, userId },
    select: { id: true, _count: { select: { transactions: true } } },
  });

  const removedTransactions = creditImport?._count.transactions ?? 0;
  await prisma.$transaction(async (db) => {
    // Gone already (deleted from the credit tab) is the end state the user asked
    // for, so mark the document rather than fail on a difference she cannot see.
    if (creditImport) await db.creditImport.delete({ where: { id: creditImport.id } });
    await db.document.update({
      where: { id: documentId },
      data: { status: "rolled_back", note: `בוטל — נמחקו ${removedTransactions} עסקאות אשראי` },
    });
  });

  // Without this file itemizing the card, the bank settlements it silenced have to
  // become visible spend again — the mirror of creditService.removeImport.
  await reconciliationService.resolveAll(userId);

  return {
    kind: "credit_report",
    removedTransactions,
    removedIncomes: 0,
    removedExpenses: 0,
    keptManual: 0,
    keptLinked: 0,
    reopenedLoans: [],
    unresolvedClosedLoans: [],
    overlappingImports: [],
    message: `הייבוא בוטל — נמחקו ${removedTransactions} עסקאות אשראי`,
  };
}

/**
 * Rows are found by `statementImportId`, never a date range — statements overlap
 * freely, so a range would take another file's rows. Hand-worked rows are
 * detached, not deleted. Also undoes any loan the rows closed and another
 * file's claim to days whose rows deduped into this batch.
 */
async function rollbackBankStatement(
  userId: number,
  documentId: number,
  statementImportId: number | null
): Promise<RollbackResult> {
  if (statementImportId === null) {
    throw ApiError.badRequest(
      "המסמך יובא לפני שהמערכת התחילה לשייך שורות לקובץ שלהן — אי אפשר לבטל אותו אוטומטית"
    );
  }
  const statement = await prisma.bankStatementImport.findFirst({
    where: { id: statementImportId, userId },
    select: { id: true, bankAccountId: true },
  });
  if (!statement) throw ApiError.badRequest("הייבוא של דף החשבון כבר אינו קיים");

  const rows = await prisma.bankTransaction.findMany({
    where: { userId, statementImportId },
    select: {
      id: true,
      resolution: true,
      linkedIncomeId: true,
      linkedExpenseId: true,
      linkedLoanId: true,
      lineKind: true,
      loanRef: true,
      amount: true,
      transactionDate: true,
    },
  });
  // Exclusion and loan-link are both hand decisions that can't be re-derived from
  // the file, so both are detached rather than deleted — keeps the dedup key
  // alive, so re-importing the file won't duplicate them.
  const keptManual = rows.filter((row) => row.resolution === "manual_excluded");
  const keptLinked = rows.filter(
    (row) => row.resolution !== "manual_excluded" && row.linkedLoanId !== null
  );
  const kept = [...keptManual, ...keptLinked];
  const doomed = rows.filter(
    (row) => row.resolution !== "manual_excluded" && row.linkedLoanId === null
  );

  const incomeIds = doomed.map((r) => r.linkedIncomeId).filter((v): v is number => v !== null);
  const expenseIds = doomed.map((r) => r.linkedExpenseId).filter((v): v is number => v !== null);

  // A loan closed by a row about to be deleted must be owed again — looked up
  // now, reopened inside the transaction.
  const { plans: reopenPlans, unresolved: unresolvedLoans } =
    await loanLifecycleService.findClosedBy(userId, doomed);

  // Other files claiming the days we're emptying. Dedup key is
  // date|amount|type|description, so a row both files carry exists once.
  const times = doomed.map((row) => row.transactionDate.getTime());
  const overlapping =
    times.length > 0
      ? await prisma.bankStatementImport.findMany({
          where: {
            userId,
            bankAccountId: statement.bankAccountId,
            id: { not: statement.id },
            coverageFrom: { lte: new Date(Math.max(...times)) },
            coverageTo: { gte: new Date(Math.min(...times)) },
          },
          select: { fileName: true, coverageFrom: true, coverageTo: true },
          orderBy: { coverageFrom: "asc" },
        })
      : [];

  await prisma.$transaction(async (db) => {
    // Income/expense first: they are what the dashboard actually sums, so leaving
    // them behind would keep the money on screen after its source row is gone.
    if (incomeIds.length > 0) {
      await db.income.deleteMany({ where: { id: { in: incomeIds }, userId } });
    }
    if (expenseIds.length > 0) {
      await db.expense.deleteMany({ where: { id: { in: expenseIds }, userId } });
    }
    if (doomed.length > 0) {
      await db.bankTransaction.deleteMany({ where: { id: { in: doomed.map((r) => r.id) }, userId } });
    }
    if (kept.length > 0) {
      await db.bankTransaction.updateMany({
        where: { id: { in: kept.map((r) => r.id) }, userId },
        data: { statementImportId: null },
      });
    }
    // The Loan a detached row points at stays standing (unlike reconciliation.reset,
    // which deletes an orphan) — a debt whose paperwork was undone is still owed.
    for (const plan of reopenPlans) await loanLifecycleService.reopen(db, plan);
    await db.bankStatementImport.delete({ where: { id: statement.id } });
    await db.document.update({
      where: { id: documentId },
      data: { status: "rolled_back", note: `בוטל — נמחקו ${doomed.length} תנועות בנק` },
    });
  });

  // Both, and outside the transaction — the same pair importStatement runs, in the
  // same order. The balance is recomputed from scratch, never adjusted.
  await accountBalanceService.recompute(userId, statement.bankAccountId);
  await reconciliationService.resolveAll(userId);

  const parts = [`הייבוא בוטל — נמחקו ${doomed.length} תנועות בנק`];
  if (keptManual.length > 0) parts.push(`${keptManual.length} שהוחרגו ידנית נשמרו`);
  if (keptLinked.length > 0) parts.push(`${keptLinked.length} שקושרו ידנית להלוואה נשמרו`);
  for (const plan of reopenPlans) {
    parts.push(
      `ההלוואה "${plan.loanName}" חזרה להיות פעילה עם יתרה של ${plan.balance.toLocaleString("he-IL")} ₪`
    );
  }
  for (const loan of unresolvedLoans) {
    parts.push(
      `יש הלוואה סגורה ("${loan.loanName}", מספר ${loan.loanNumber}) שאולי קשורה לשורות שנמחקו — ` +
        `כדאי לבדוק ולעדכן את היתרה ידנית אם צריך`
    );
  }
  for (const other of overlapping) {
    parts.push(
      `התאריכים ${iso(other.coverageFrom)}–${iso(other.coverageTo)} מכוסים גם בקובץ "${other.fileName}" — ` +
        `כדאי לייבא אותו מחדש כדי לא לאבד תנועות`
    );
  }

  return {
    kind: "bank_statement",
    removedTransactions: doomed.length,
    removedIncomes: incomeIds.length,
    removedExpenses: expenseIds.length,
    keptManual: keptManual.length,
    keptLinked: keptLinked.length,
    reopenedLoans: reopenPlans.map((plan) => ({
      loanName: plan.loanName,
      balance: plan.balance,
    })),
    unresolvedClosedLoans: unresolvedLoans,
    overlappingImports: overlapping.map((other) => ({
      fileName: other.fileName,
      coverageFrom: iso(other.coverageFrom),
      coverageTo: iso(other.coverageTo),
    })),
    message: parts.join("; "),
  };
}

export const documentsService = {
  labelOf: (kind: string) => KIND_LABELS[kind as DocumentKind] ?? kind,

  /** Write the record. Never throws — see the note on best-effort above. */
  async record(userId: number, input: RecordDocumentInput): Promise<void> {
    try {
      const storagePath = input.buffer
        ? await documentStorage.save(userId, input.fileHash, input.fileName, input.buffer)
        : null;
      await prisma.document.create({
        data: {
          storagePath,
          userId,
          fileName: input.fileName,
          fileHash: input.fileHash,
          sizeBytes: input.sizeBytes,
          kind: input.kind,
          status: input.status ?? "imported",
          coverageFrom: input.coverageFrom ?? null,
          coverageTo: input.coverageTo ?? null,
          linkedLoanId: input.linkedLoanId ?? null,
          linkedAccountId: input.linkedAccountId ?? null,
          linkedCreditImportId: input.linkedCreditImportId ?? null,
          linkedStatementImportId: input.linkedStatementImportId ?? null,
          rowsParsed: input.rowsParsed ?? 0,
          rowsImported: input.rowsImported ?? 0,
          rowsSkipped: input.rowsSkipped ?? 0,
          detectionJson: input.detection ? JSON.stringify(input.detection) : null,
          note: input.note ?? null,
        },
      });
    } catch (error) {
      console.warn("[מרכז מסמכים] לא הצלחנו לרשום את המסמך — הייבוא עצמו הצליח", error);
    }
  },

  /**
   * Everything uploaded, newest first, plus the figures the screen shows.
   * Counting happens here so the UI renders rather than derives (CLAUDE.md §4).
   */
  async list(userId: number) {
    const documents = await prisma.document.findMany({
      where: { userId },
      orderBy: { uploadedAt: "desc" },
    });

    const items = documents.map((doc) => ({
      ...doc,
      kindLabel: KIND_LABELS[doc.kind as DocumentKind] ?? doc.kind,
      /** Decided here, not in the UI, so the screen renders rather than derives (§4). */
      hasFile: doc.storagePath !== null,
      canRollback:
        doc.status === "imported" && ROLLBACK_KINDS.includes(doc.kind as DocumentKind),
      uploadedAt: doc.uploadedAt.toISOString(),
      coverageFrom: doc.coverageFrom?.toISOString().slice(0, 10) ?? null,
      coverageTo: doc.coverageTo?.toISOString().slice(0, 10) ?? null,
    }));

    const byKind = new Map<string, number>();
    for (const doc of documents) byKind.set(doc.kind, (byKind.get(doc.kind) ?? 0) + 1);

    // The same file uploaded twice shares a hash. Worth surfacing: it is the
    // most common reason a user thinks data is missing when it is merely deduped.
    const hashes = new Map<string, number>();
    for (const doc of documents) hashes.set(doc.fileHash, (hashes.get(doc.fileHash) ?? 0) + 1);

    const covered = documents
      .filter((doc) => doc.coverageFrom && doc.coverageTo)
      .map((doc) => ({ from: doc.coverageFrom!, to: doc.coverageTo! }));

    return {
      items,
      summary: {
        total: documents.length,
        rowsImported: documents.reduce((sum, doc) => sum + doc.rowsImported, 0),
        duplicateUploads: [...hashes.values()].filter((count) => count > 1).length,
        byKind: [...byKind.entries()].map(([kind, count]) => ({
          kind,
          label: KIND_LABELS[kind as DocumentKind] ?? kind,
          count,
        })),
        /** Earliest and latest day any statement covers — the data's real span. */
        coverageFrom:
          covered.length > 0
            ? new Date(Math.min(...covered.map((c) => c.from.getTime()))).toISOString().slice(0, 10)
            : null,
        coverageTo:
          covered.length > 0
            ? new Date(Math.max(...covered.map((c) => c.to.getTime()))).toISOString().slice(0, 10)
            : null,
      },
    };
  },

  /** Remove a log entry only — the imported transactions are untouched. */
  async remove(userId: number, id: number) {
    const existing = await prisma.document.findFirst({ where: { id, userId } });
    if (!existing) throw ApiError.notFound("המסמך לא נמצא");
    if (existing.storagePath) await documentStorage.remove(existing.storagePath);
    await prisma.document.delete({ where: { id } });
  },

  /** The stored bytes, for download or preview. */
  async file(userId: number, id: number) {
    const doc = await prisma.document.findFirst({ where: { id, userId } });
    if (!doc) throw ApiError.notFound("המסמך לא נמצא");
    if (!doc.storagePath) {
      throw ApiError.notFound("הקובץ עצמו לא נשמר — המסמך הועלה לפני שהמערכת התחילה לשמור קבצים");
    }
    const stream = await documentStorage.openRead(doc.storagePath);
    if (!stream) throw ApiError.notFound("הקובץ רשום במערכת אך אינו נמצא בדיסק");
    return { stream, fileName: doc.fileName, contentType: contentTypeOf(doc.fileName) };
  },

  /**
   * Undo an import: delete the rows the file created, keep the Document as a
   * record. The opposite of `remove` above, which touches only the log.
   */
  async rollback(userId: number, id: number): Promise<RollbackResult> {
    const doc = await prisma.document.findFirst({ where: { id, userId } });
    if (!doc) throw ApiError.notFound("המסמך לא נמצא");
    if (doc.status === "rolled_back") throw ApiError.badRequest("הייבוא הזה כבר בוטל");
    if (!ROLLBACK_KINDS.includes(doc.kind as DocumentKind)) {
      throw ApiError.badRequest("אפשר לבטל רק ייבוא של דף חשבון בנק או של דוח אשראי");
    }
    return doc.kind === "credit_report"
      ? rollbackCreditReport(userId, doc.id, doc.linkedCreditImportId)
      : rollbackBankStatement(userId, doc.id, doc.linkedStatementImportId);
  },
};
