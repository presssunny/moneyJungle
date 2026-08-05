import { prisma } from "../../config/database";
import { ApiError } from "../../utils/ApiError";

/**
 * The record of every uploaded file and what came of it. Recording is best-effort
 * and non-blocking: an import that succeeded must never be reported as failed
 * because the bookkeeping row could not be written.
 */

export type DocumentKind =
  | "bank_statement"
  | "credit_report"
  | "loan_schedule"
  | "expense_sheet"
  | "unknown";

export interface RecordDocumentInput {
  fileName: string;
  fileHash: string;
  sizeBytes: number;
  kind: DocumentKind;
  status?: "imported" | "rejected" | "superseded";
  coverageFrom?: Date | null;
  coverageTo?: Date | null;
  linkedLoanId?: number | null;
  linkedAccountId?: number | null;
  linkedCreditImportId?: number | null;
  rowsParsed?: number;
  rowsImported?: number;
  rowsSkipped?: number;
  detection?: unknown;
  note?: string | null;
}

const KIND_LABELS: Record<DocumentKind, string> = {
  bank_statement: "דף חשבון בנק",
  credit_report: "דוח כרטיס אשראי",
  loan_schedule: "לוח סילוקין",
  expense_sheet: "גיליון הוצאות",
  unknown: "לא זוהה",
};

export const documentsService = {
  labelOf: (kind: string) => KIND_LABELS[kind as DocumentKind] ?? kind,

  /** Write the record. Never throws — see the note on best-effort above. */
  async record(userId: number, input: RecordDocumentInput): Promise<void> {
    try {
      await prisma.document.create({
        data: {
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

  /**
   * Remove a record. The imported DATA is untouched — this is a log entry, not
   * the transactions themselves, and deleting the log must never silently delete
   * money. Said plainly in the UI so it cannot be misread as "undo import".
   */
  async remove(userId: number, id: number) {
    const existing = await prisma.document.findFirst({ where: { id, userId } });
    if (!existing) throw ApiError.notFound("המסמך לא נמצא");
    await prisma.document.delete({ where: { id } });
  },
};
