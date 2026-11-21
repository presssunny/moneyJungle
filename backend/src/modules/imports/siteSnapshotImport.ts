import { prisma } from "../../config/database";
import { businessDate } from "../../utils/date.utils";
import { loanSnapshotService, readLoanDetailsFile } from "../loans/loanSnapshot.service";
import { readStandingOrdersFile, standingOrdersService } from "../recurring/standingOrders.service";
import type { SiteSnapshotKind, SiteSnapshotPreview } from "../../types/siteSnapshot.types";
import type { ImportOrigin } from "./importRows.service";

// What the bank's pages showed after her sign-in (CLAUDE.md §7 A2) enters like a file: a preview, then her approval.
export const SITE_SNAPSHOT_KINDS: readonly SiteSnapshotKind[] = ["loan_details", "standing_orders"];
export const isSiteSnapshotKind = (kind: string | undefined): kind is SiteSnapshotKind => SITE_SNAPSHOT_KINDS.some((k) => k === kind);

export interface SiteSnapshotSession { origin: string; createdAt: Date; }
interface Answers { kind?: string; accountId?: number; }

export interface SiteSnapshotPrepared { blockingIssues: string[]; warnings: string[]; siteSnapshot?: SiteSnapshotPreview; }

const syncDayOf = (session: SiteSnapshotSession) => businessDate(session.createdAt);
const UNREADABLE = "פרטי האתר שנשמרו בסנכרון לא נקראו. אפשר לבטל ולרענן שוב.";

async function ownedAccount(userId: number, accountId: number | undefined): Promise<number | null> {
  if (!accountId) return null;
  return (await prisma.bankAccount.findFirst({ where: { id: accountId, userId }, select: { id: true } }))?.id ?? null;
}

/** Only the server's own sync writes these files; an upload that claims the kind is refused. */
export async function prepareSiteSnapshot(userId: number, kind: SiteSnapshotKind, buffer: Buffer, answers: Answers, session: SiteSnapshotSession & { origin: ImportOrigin | string }): Promise<SiteSnapshotPrepared> {
  if (session.origin !== "sync") return { blockingIssues: ["סוג הייבוא הזה נוצר רק מסנכרון עם הבנק."], warnings: [] };
  const accountId = await ownedAccount(userId, answers.accountId);
  if (kind === "loan_details") {
    const loans = readLoanDetailsFile(buffer);
    if (!loans) return { blockingIssues: [UNREADABLE], warnings: [] };
    const preview = await loanSnapshotService.preview(userId, loans, syncDayOf(session), accountId ?? undefined);
    return { blockingIssues: [], siteSnapshot: preview, warnings: [
      "פרטי ההלוואות מאתר הבנק משלימים רק שדות ריקים בהלוואה שהותאמה. הם לא משנים את ההחזר החודשי, לוח סילוקין שהעלית או נתון שהזנת, ולא מוסיפים הוצאות.",
    ] };
  }
  const orders = readStandingOrdersFile(buffer);
  if (!orders) return { blockingIssues: [UNREADABLE], warnings: [] };
  if (!accountId) return { blockingIssues: ["חשבון הבנק של הסנכרון כבר לא קיים."], warnings: [] };
  const preview = await standingOrdersService.preview(userId, accountId, orders);
  return { blockingIssues: [], siteSnapshot: preview, warnings: [
    "הרשימה מאתר הבנק רק מסמנת תשלומים קבועים כמאומתים. הסכום והמועד נשארים לפי החיוב האחרון בעו״ש, ולא נוספות הוצאות.",
  ] };
}

export async function commitSiteSnapshot(userId: number, kind: SiteSnapshotKind, buffer: Buffer, answers: Answers, session: SiteSnapshotSession, accept: string[]) {
  const accountId = await ownedAccount(userId, answers.accountId);
  if (kind === "loan_details") {
    const { preview, records, updated } = await loanSnapshotService.apply(userId, readLoanDetailsFile(buffer) ?? [], syncDayOf(session), accountId ?? undefined);
    return { preview, details: { kind, updated, records } };
  }
  const { preview, labelled, added } = await standingOrdersService.apply(userId, accountId!, readStandingOrdersFile(buffer) ?? [], accept, syncDayOf(session));
  return { preview, details: { kind, labelled, added } };
}
