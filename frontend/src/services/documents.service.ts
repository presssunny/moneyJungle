import { api } from "./api";

/** A file that was uploaded, and what came of it. */
export interface DocumentRecord {
  id: number;
  fileName: string;
  fileHash: string;
  sizeBytes: number;
  kind: string;
  kindLabel: string;
  status: "imported" | "rejected" | "superseded" | "rolled_back";
  detectedBank: string | null;
  coverageFrom: string | null;
  coverageTo: string | null;
  linkedLoanId: number | null;
  linkedAccountId: number | null;
  linkedCreditImportId: number | null;
  linkedStatementImportId: number | null;
  storagePath: string | null;
  /** Both decided by the server, so the screen renders rather than derives. */
  hasFile: boolean;
  canRollback: boolean;
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

export interface RollbackResult {
  kind: string;
  removedTransactions: number;
  removedIncomes: number;
  removedExpenses: number;
  /** Rows the user had excluded by hand — kept, never deleted. */
  keptManual: number;
  /** Rows she tied to a loan by hand — kept for the same reason. */
  keptLinked: number;
  /** Loans the undone import had closed, now owed again with their exact balance. */
  reopenedLoans: Array<{ loanName: string; balance: number }>;
  /**
   * Closed loans on the same bank loan number as a deleted row, with no record of
   * which row closed them. Named rather than reopened on a guessed balance.
   */
  unresolvedClosedLoans: Array<{ loanName: string; loanNumber: string }>;
  /** Other files covering the same days, whose overlapping rows deduped into this one. */
  overlappingImports: Array<{ fileName: string; coverageFrom: string; coverageTo: string }>;
  message: string;
}

/** Undoes the IMPORT: deletes the transactions the file created. Not `deleteDocument`. */
export async function rollbackDocument(id: number): Promise<RollbackResult> {
  const { data } = await api.post(`/documents/${id}/rollback`);
  return data;
}

/** Fetched as a blob, not linked directly — the endpoint needs the gate bearer token. */
export async function fetchDocumentFile(id: number): Promise<Blob> {
  const { data } = await api.get(`/documents/${id}/file`, { responseType: "blob" });
  return data;
}

/** One row the system recognized from the file, and what became of it. */
export interface DocumentRow {
  rowNumber: number;
  date: string | null;
  name: string;
  amount: number;
  chargeDate: string | null;
  resolution: string;
  resolutionLabel: string;
}

export interface DocumentRowsPage {
  available: boolean;
  total: number;
  page: number;
  pageSize: number;
  rows: DocumentRow[];
}

/**
 * What the file produced, row by row — the extraction behind the numbers,
 * so it can be checked before it's trusted. `available: false` for a
 * document from before row-level tracking existed; never guessed rows.
 */
export async function getDocumentRows(id: number, page = 1): Promise<DocumentRowsPage> {
  const { data } = await api.get(`/documents/${id}/rows`, { params: { page } });
  return data;
}

/**
 * Hand the file to the browser under its own name. A download anchor rather than
 * window.open — a popup blocker stops the latter without saying why.
 */
export async function downloadDocumentFile(id: number, fileName: string): Promise<void> {
  const blob = await fetchDocumentFile(id);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoked a tick later: some browsers cancel a download whose blob URL is
  // released in the same task as the click.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
