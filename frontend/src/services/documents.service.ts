import { api } from "./api";

/** A file that was uploaded, and what came of it. Metadata only — never the bytes. */
export interface DocumentRecord {
  id: number;
  fileName: string;
  fileHash: string;
  sizeBytes: number;
  kind: string;
  kindLabel: string;
  status: "imported" | "rejected" | "superseded";
  detectedBank: string | null;
  coverageFrom: string | null;
  coverageTo: string | null;
  linkedLoanId: number | null;
  linkedAccountId: number | null;
  linkedCreditImportId: number | null;
  rowsParsed: number;
  rowsImported: number;
  rowsSkipped: number;
  detectionJson: string | null;
  note: string | null;
  uploadedAt: string;
}

export interface DocumentsSummary {
  total: number;
  rowsImported: number;
  /** Files uploaded more than once (same hash) — the usual "where is my data?". */
  duplicateUploads: number;
  byKind: Array<{ kind: string; label: string; count: number }>;
  coverageFrom: string | null;
  coverageTo: string | null;
}

export async function listDocuments(): Promise<{
  items: DocumentRecord[];
  summary: DocumentsSummary;
}> {
  const { data } = await api.get("/documents");
  return data;
}

/** Removes the log entry only — imported transactions are not touched. */
export async function deleteDocument(id: number): Promise<void> {
  await api.delete(`/documents/${id}`);
}
