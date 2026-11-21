import { accountEvidence } from "../bank/statementCommitments.service";
import { detectStatementCommitments } from "../bank/statementCommitments.detector";
import type { DebitEvidence } from "../../types/commitments.types";
import { standingOrdersFile } from "../recurring/standingOrders.service";
import type { LoginMethod, ScrapedTransaction, ScrapeExtras, SyncOutcomeItem, SyncStage } from "../../types/connections.types";
import { checkingDebits, importSiteFile, readStage, SYNC_FILE_PREFIX } from "./loanSync.service";
import type { ProviderInfo } from "./providers";
import { israelDay } from "./scrapeWorkbook";

// Parent only, like loanSync.service: it reaches Prisma.
const DAY_MS = 24 * 60 * 60 * 1000;
// Three monthly debits can sit ~51 days apart (day-of-month drift), so below this "none found" proves nothing.
export const MIN_INFERENCE_DAYS = 60;

/**
 * Recurring debits the checking rows suggest — inferred, never a standing order the bank confirmed.
 * Loan payments and card settlements are not counted: the detector's "recurring" kind takes only standard lines.
 */
export function standingOrdersDetectionStage(evidence: DebitEvidence | null): SyncStage {
  const count = evidence ? detectStatementCommitments(evidence.debits, evidence.last).filter((c) => c.kind === "recurring").length : 0;
  if (count) return { stage: "standing_orders_detection", state: "done", code: "INFERRED", count };
  const short = !evidence || (evidence.last.getTime() - evidence.first.getTime()) / DAY_MS < MIN_INFERENCE_DAYS;
  return { stage: "standing_orders_detection", state: "skipped", code: short ? "WINDOW_TOO_SHORT" : "NO_RECURRING", count: 0 };
}

/** Downloading the bank's documents needs CLAUDE.md §7 clause B, not approved. */
export const BANK_DOCUMENTS_BLOCKED: SyncStage = { stage: "bank_documents", state: "blocked", code: "NOT_APPROVED" };
const VERIFICATION_BLOCKED: SyncStage = { stage: "standing_orders_verification", state: "blocked", code: "NOT_APPROVED" };

/**
 * What the worker's visit to the standing-orders page brought (§7 A2). `enabled` is CONNECTION_DEPARTMENT_READ
 * naming the department; a report from the worker is proof enough that it ran.
 */
export function standingOrdersVerificationStage(enabled: boolean, method: LoginMethod, extras: ScrapeExtras | undefined): SyncStage {
  const stage = "standing_orders_verification" as const;
  const report = extras?.followUp?.standingOrders;
  if (!report) {
    if (!enabled) return VERIFICATION_BLOCKED;
    if (method !== "official_window") return { stage, state: "skipped", code: "NOT_OFFICIAL_WINDOW" };
    return extras?.followUp ? { stage, state: "skipped", code: "NOT_RUN" } : { stage, state: "failed", code: "ERROR" };
  }
  if (report.details === "NOT_APPROVED") return VERIFICATION_BLOCKED;
  if (extras.errors.includes("EXTRAS_INVALID")) return { stage, state: "failed", code: "EXTRAS_INVALID" };
  if (report.details === "READ") return readStage(stage, extras.standingOrders?.length ?? 0, report.rejected);
  if (report.department === "NOT_NEEDED") return { stage, state: "skipped", code: "NOT_NEEDED" };
  if (report.department !== "landed") return { stage, state: "failed", code: report.department };
  return report.details === "NOT_RUN" ? { stage, state: "skipped", code: "NOT_RUN" } : { stage, state: "failed", code: report.details };
}

export const STANDING_ORDERS_KEY = "standing_orders";

/** The bank's list, matched to the checking debits on the import screen; nothing is stored before she approves. */
export async function importStandingOrders(userId: number, connectionId: number, provider: ProviderInfo, accountId: number, extras: ScrapeExtras | undefined): Promise<SyncOutcomeItem | null> {
  if (extras?.followUp?.standingOrders?.details !== "READ" || extras.errors.includes("EXTRAS_INVALID") || !extras.standingOrders?.length) return null;
  const fileName = `${SYNC_FILE_PREFIX}${provider.name} הוראות קבע מהאתר ${israelDay(new Date().toISOString())}.json`;
  const importSessionId = await importSiteFile(userId, connectionId, STANDING_ORDERS_KEY, fileName, standingOrdersFile(extras.standingOrders), { kind: "standing_orders", accountId });
  return { kind: "standing_orders", key: STANDING_ORDERS_KEY, target: "הוראות קבע מאתר הבנק", importSessionId, rows: extras.standingOrders.length, skippedPending: 0, skippedForeign: 0, skippedZero: 0,
    storedThrough: null, pending: [], foreign: [], ...(importSessionId ? {} : { note: "הרשימה הזו כבר אושרה" }) };
}

/**
 * A re-sync reads only a few days, so the account's stored rows carry the history. The fresh rows are
 * not approved yet — fine for counting what is inferred, never stored or offered from here.
 */
export async function standingOrdersStages(userId: number, accountId: number, txns: ScrapedTransaction[], verification: SyncStage = VERIFICATION_BLOCKED): Promise<SyncStage[]> {
  const completed = txns.filter((t) => t.status === "completed");
  const days = completed.map((t) => new Date(`${israelDay(t.date)}T00:00:00Z`));
  const detection = await accountEvidence(userId, accountId, checkingDebits(completed), days, { newerOnly: true })
    .then(standingOrdersDetectionStage)
    .catch((error: unknown): SyncStage => {
      console.error("[סנכרון] זיהוי הוראות קבע נכשל", error instanceof Error ? error.name : "unknown");
      return { stage: "standing_orders_detection", state: "failed", code: "ERROR", count: 0 };
    });
  return [detection, verification, BANK_DOCUMENTS_BLOCKED];
}
