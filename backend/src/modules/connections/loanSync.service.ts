import { prisma } from "../../config/database";
import { classifyBankLine } from "../bank/bankParser.service";
import { loanDays } from "../bank/statementCommitments.detector";
import { importSessions } from "../imports/importSession.service";
import { loanLabel } from "../loans/loanSchedule.service";
import { loanDetailsFile } from "../loans/loanSnapshot.service";
import { parseLoanSchedule, ScheduleParseError } from "../loans/loanSchedule.parser";
import type { StatementDebit } from "../../types/commitments.types";
import type {
  LoanFollowUpDecision, LoginMethod, ScrapedTransaction, ScrapeExtras, ScrapeResult, SyncOutcomeItem, SyncStage,
} from "../../types/connections.types";
import type { ProviderInfo } from "./providers";
import { bankDay, israelDay, loanScheduleWorkbook } from "./scrapeWorkbook";
import { departmentReadList } from "./siteDepartments";

// Parent only: the sync worker never loads this file (it reaches bankParser and Prisma).
export const SYNC_FILE_PREFIX = "סנכרון ";

// A newer sync covers everything the older one offered; two open sessions with the same rows could both be approved.
export async function cancelUnapproved(userId: number, connectionId: number, key: string, keep: string | null = null) {
  const previous = await prisma.connectionSync.findMany({ where: { connectionId, status: "succeeded" }, select: { outcome: true } });
  const ids = previous.flatMap((p) => (Array.isArray(p.outcome) ? (p.outcome as unknown as SyncOutcomeItem[]) : []))
    .filter((item) => item.key === key && item.importSessionId && item.importSessionId !== keep).map((item) => item.importSessionId!);
  // An approved session can no longer be cancelled — `cancel` refuses it, which is the point.
  for (const id of ids) await importSessions.cancel(userId, id).catch(() => undefined);
}

/** The checking rows as the statement detector sees them: debit by the charged sign (§5), kind by the one classifier. */
export function checkingDebits(txns: ScrapedTransaction[]): StatementDebit[] {
  return txns.filter((t) => t.status === "completed" && t.chargedAmount < 0).map((t) => {
    const { lineKind, loanRef } = classifyBankLine(t.description, "withdrawal");
    return { date: new Date(`${israelDay(t.date)}T00:00:00Z`), description: t.description, amount: -t.chargedAmount, lineKind, loanRef };
  });
}

/**
 * A re-sync window can be three days, too short for the detector's two months, so loan lines in it
 * or a statement-only loan still waiting for its schedule are each reason enough to look.
 */
export async function decideLoanFollowUp(userId: number, checking: ScrapeResult): Promise<LoanFollowUpDecision> {
  const standingOrders = departmentReadList(process.env.CONNECTION_DEPARTMENT_READ).includes("standing_orders");
  const txns = (checking.accounts ?? []).flatMap((account) => account.txns);
  if (loanDays(checkingDebits(txns)).length) return { loans: true, standingOrders };
  const waiting = await prisma.loan.count({ where: { userId, scheduleSource: "statement", status: { not: "finished" } } });
  return { loans: waiting > 0, standingOrders };
}

export function loanDetectionStage(txns: ScrapedTransaction[]): SyncStage {
  const days = loanDays(checkingDebits(txns));
  if (!days.length) return { stage: "loan_detection", state: "skipped", code: "NO_LOAN_LINES", count: 0 };
  const unnumbered = days.filter((d) => d.loanNumber === null).length;
  return unnumbered
    ? { stage: "loan_detection", state: "partial", code: "AMBIGUOUS", count: unnumbered }
    : { stage: "loan_detection", state: "done", code: null, count: days.length };
}

/** A table that was read; rows the parser could not place make it partial, since a dropped row may be a missing loan (banker). */
export function readStage(stage: "loan_details" | "standing_orders_verification", count: number, rejected = 0): SyncStage {
  return rejected > 0 ? { stage, state: "partial", code: "ROWS_UNRECOGNIZED", count, rejected } : { stage, state: "done", code: null, count };
}

/** What the worker's follow-up reached, as two stages. Details are read only for a department in CONNECTION_DEPARTMENT_READ (§7 A2); otherwise blocked. */
export function followUpStages(enabled: boolean, method: LoginMethod, extras: ScrapeExtras | undefined, loanLines = true): SyncStage[] {
  const blocked: SyncStage = { stage: "loan_details", state: "blocked", code: "NOT_APPROVED" };
  // Not attempted: with no loan line in the checking rows there were no details to miss, so no warning either.
  const unattempted = loanLines ? blocked : { stage: "loan_details" as const, state: "skipped" as const, code: "NOT_NEEDED" };
  if (!enabled) return [{ stage: "loans_department", state: "skipped", code: "DISABLED" }, unattempted];
  if (method !== "official_window") return [{ stage: "loans_department", state: "skipped", code: "NOT_OFFICIAL_WINDOW" }, unattempted];
  const followUp = extras?.followUp;
  if (!followUp) return [{ stage: "loans_department", state: "failed", code: "ERROR" }, { stage: "loan_details", state: "skipped", code: "NOT_RUN" }];
  const department: SyncStage = followUp.department === "landed" ? { stage: "loans_department", state: "done", code: null }
    : followUp.department === "NOT_NEEDED" ? { stage: "loans_department", state: "skipped", code: "NOT_NEEDED" }
    : { stage: "loans_department", state: "failed", code: followUp.department };
  const invalid = extras.errors.includes("EXTRAS_INVALID");
  const details: SyncStage = invalid ? { stage: "loan_details", state: "failed", code: "EXTRAS_INVALID" }
    : followUp.details === "NOT_APPROVED" ? blocked
    : followUp.details === "READ" ? readStage("loan_details", extras.loans?.length ?? 0, followUp.rejected)
    : followUp.details === "NOT_RUN" ? { stage: "loan_details", state: "skipped", code: followUp.department === "NOT_NEEDED" ? "NOT_NEEDED" : "NOT_RUN" }
    : { stage: "loan_details", state: "failed", code: followUp.details };
  return [department, details];
}

type LoanImport = { item: SyncOutcomeItem } | { problem: string };

async function importLoan(userId: number, connectionId: number, provider: ProviderInfo, loan: NonNullable<ScrapeExtras["loans"]>[number]): Promise<LoanImport> {
  const workbook = loanScheduleWorkbook(loan);
  if ("skip" in workbook) return { problem: workbook.skip };
  // Checked before a session exists: the parser's own message names amounts, which never reach the outcome.
  let label: string;
  try { label = loanLabel(parseLoanSchedule(workbook.buffer)); } catch (error) {
    if (error instanceof ScheduleParseError) return { problem: "SCHEDULE_REJECTED" };
    throw error;
  }
  const key = `loan:${loan.loanNumber}:${loan.trackNumber ?? "-"}`;
  const base: SyncOutcomeItem = { kind: "loan_schedule", key, target: label, importSessionId: null, rows: workbook.rows, skippedPending: 0, skippedForeign: 0, skippedZero: 0, storedThrough: null, pending: [], foreign: [] };
  await cancelUnapproved(userId, connectionId, key);
  const asOf = bankDay(loan.asOf);
  const session = await importSessions.create(userId, `${SYNC_FILE_PREFIX}${provider.name} לוח סילוקין ${label}${asOf ? ` ${asOf}` : ""}.xlsx`, workbook.buffer, { kind: "loan_schedule" }, "sync");
  // An identical file returns its earlier session, which may already be approved.
  if (["review", "completed"].includes(session.status)) return { item: { ...base, note: "הלוח הזה כבר נקלט" } };
  return { item: { ...base, importSessionId: session.id } };
}

/**
 * Each track becomes a loan-schedule import she approves like a file (CLAUDE.md §7: only through
 * the import). One track failing never fails the others, nor the sync.
 */
export async function importScrapedLoans(userId: number, connectionId: number, provider: ProviderInfo, extras: ScrapeExtras | undefined): Promise<{ items: SyncOutcomeItem[]; stage: SyncStage }> {
  // A track with no rows is the loans page's snapshot: it goes to importLoanDetails, never to a schedule.
  const loans = (extras?.loans ?? []).filter((loan) => loan.schedule.length);
  if (!loans.length) return { items: [], stage: { stage: "loan_schedule_import", state: "skipped", code: null, count: 0 } };
  const items: SyncOutcomeItem[] = [];
  const problems: string[] = [];
  for (const loan of loans) {
    try {
      const done = await importLoan(userId, connectionId, provider, loan);
      if ("item" in done) items.push(done.item); else problems.push(done.problem);
    } catch (error) {
      console.error("[סנכרון] שמירת לוח סילוקין נכשלה", error instanceof Error ? error.name : "unknown");
      problems.push("IMPORT_FAILED");
    }
  }
  const waiting = items.filter((item) => item.importSessionId).length;
  const state = !problems.length ? "done" : items.length ? "partial" : "failed";
  return { items, stage: { stage: "loan_schedule_import", state, code: problems[0] ?? null, count: waiting } };
}

export const LOAN_DETAILS_KEY = "loan_details";

/**
 * The bank's own figures for the tracks it lists, all in one import she reviews (CLAUDE.md §7 A2). The same read
 * again is the same file, so the same session; a different one replaces the open one.
 */
export async function importSiteFile(userId: number, connectionId: number, key: string, fileName: string, buffer: Buffer, answers: { kind: "loan_details" | "standing_orders"; accountId?: number }) {
  const session = await importSessions.create(userId, fileName, buffer, answers, "sync");
  await cancelUnapproved(userId, connectionId, key, session.id);
  return ["review", "completed"].includes(session.status) ? null : session.id;
}

export async function importLoanDetails(userId: number, connectionId: number, provider: ProviderInfo, accountId: number, extras: ScrapeExtras | undefined): Promise<SyncOutcomeItem | null> {
  if (extras?.followUp?.details !== "READ" || extras.errors.includes("EXTRAS_INVALID")) return null;
  const snapshots = (extras.loans ?? []).filter((loan) => !loan.schedule.length);
  if (!snapshots.length) return null;
  const fileName = `${SYNC_FILE_PREFIX}${provider.name} פרטי הלוואות מהאתר ${israelDay(new Date().toISOString())}.json`;
  const importSessionId = await importSiteFile(userId, connectionId, LOAN_DETAILS_KEY, fileName, loanDetailsFile(snapshots), { kind: "loan_details", accountId });
  return { kind: "loan_details", key: LOAN_DETAILS_KEY, target: "פרטי הלוואות מאתר הבנק", importSessionId, rows: snapshots.length, skippedPending: 0, skippedForeign: 0, skippedZero: 0,
    storedThrough: null, pending: [], foreign: [], ...(importSessionId ? {} : { note: "הפרטים האלה כבר אושרו" }) };
}
