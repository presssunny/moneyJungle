import { businessDate } from "../journey/journey.utils";
import { prisma } from "../../config/database";
import { decimalOrNull, decimalToNumber, round2 } from "../../utils/money.utils";

/**
 * Account balance, derived — never accumulated: the newest printed closing
 * balance plus only what is dated after it, so re-importing an overlapping
 * statement cannot drift it. With no anchor at all it falls back to the
 * accumulated sum and SAYS so — an admitted estimate beats a false fact. With no
 * anchor and no opening balance either, it is unknown (null), never 0.
 */
export type BalanceBasis = "statement" | "accumulated" | "unknown";

export interface DerivedBalance {
  /** null = unknown: nothing states where the account started or stands. */
  balance: number | null;
  basis: BalanceBasis;
  /** The anchor it is measured from — null when falling back. */
  anchor: {
    /** Null for a balance the user stated rather than a parsed statement. */
    statementId: number | null;
    fileName: string;
    coverageTo: string;
    closingBalance: number;
  } | null;
  /** Net movement of transactions dated after the anchor, included above. */
  afterAnchorNet: number;
  afterAnchorCount: number;
  /** Hebrew, for the UI: where this number comes from. */
  explanation: string;
}

function signed(type: string, amount: number): number {
  return type === "deposit" ? amount : -amount;
}

/** An anchor states the account's balance as of a date — from either source. */
interface Anchor {
  statementId: number | null;
  fileName: string;
  asOf: Date;
  balance: number;
}

/**
 * The anchor to measure from: the most recent statement of the account that
 * carried a printed closing balance, or a balance the user stated herself —
 * whichever is dated later. Ties break on the later import.
 */
async function findAnchor(
  userId: number,
  accountId: number,
  account: { anchorBalance: unknown; anchorDate: Date | null },
  asOf: Date
): Promise<Anchor | null> {
  const statement = await prisma.bankStatementImport.findFirst({
    where: { userId, bankAccountId: accountId, closingBalance: { not: null }, coverageTo: { lte: asOf } },
    orderBy: [{ coverageTo: "desc" }, { createdAt: "desc" }],
  });
  const fromStatement: Anchor | null =
    statement && statement.closingBalance !== null
      ? {
          statementId: statement.id,
          fileName: statement.fileName,
          asOf: statement.coverageTo,
          balance: decimalToNumber(statement.closingBalance),
        }
      : null;

  const fromUser: Anchor | null =
    account.anchorDate !== null && account.anchorBalance !== null && account.anchorDate <= asOf
      ? {
          statementId: null,
          fileName: "יתרה שהוזנה ידנית",
          asOf: account.anchorDate,
          balance: decimalToNumber(account.anchorBalance as never),
        }
      : null;

  if (!fromStatement) return fromUser;
  if (!fromUser) return fromStatement;
  return fromUser.asOf >= fromStatement.asOf ? fromUser : fromStatement;
}

/**
 * The accounts' total. One unknown balance makes it unknown — not "at least": a
 * bank balance can be an overdraft, so the known part is no lower bound.
 */
export function bankTotals(balances: Array<number | null>): { totalBalance: number | null; unknownBalanceCount: number } {
  const unknownBalanceCount = balances.filter((b) => b === null).length;
  return { totalBalance: unknownBalanceCount ? null : round2(balances.reduce<number>((sum, b) => sum + (b ?? 0), 0)), unknownBalanceCount };
}

export const accountBalanceService = {
  /**
   * Compute the balance from scratch, as of today or of an earlier day (end of that
   * day) — e.g. the last row a sync pulled. Pure read — nothing is written here.
   */
  async derive(userId: number, accountId: number, asOf: Date = new Date(businessDate())): Promise<DerivedBalance> {
    const account = await prisma.bankAccount.findFirst({
      where: { id: accountId, userId },
      select: { initialBalance: true, anchorBalance: true, anchorDate: true },
    });
    if (!account) throw new Error(`bank account ${accountId} not found for user ${userId}`);

    const anchor = await findAnchor(userId, accountId, account, asOf);

    const opening = decimalOrNull(account.initialBalance);
    if (!anchor && opening === null) {
      return {
        balance: null,
        basis: "unknown",
        anchor: null,
        afterAnchorNet: 0,
        afterAnchorCount: 0,
        explanation: "יתרה לא ידועה — אין יתרת פתיחה, דוח עם יתרה מודפסת או יתרה שהזנת",
      };
    }

    if (!anchor) {
      // No statement ever reported a balance — the best we can do is the old
      // sum. Reported as "accumulated" so the UI never presents it as verified.
      const all = await prisma.bankTransaction.findMany({
        where: { userId, bankAccountId: accountId, transactionDate: { lte: asOf } },
        select: { amount: true, type: true },
      });
      const net = all.reduce((sum, t) => sum + signed(t.type, decimalToNumber(t.amount)), 0);
      return {
        balance: round2((opening ?? 0) + net),
        basis: "accumulated",
        anchor: null,
        afterAnchorNet: round2(net),
        afterAnchorCount: all.length,
        explanation:
          "אין דוח עם יתרה מודפסת — היתרה מחושבת כיתרת פתיחה ועוד כל התנועות, וייתכן שאינה מדויקת",
      };
    }

    // Everything up to the anchor date is already inside that balance, no matter
    // how many statements covered the period. Only later rows are added.
    const after = await prisma.bankTransaction.findMany({
      where: {
        userId,
        bankAccountId: accountId,
        transactionDate: { gt: anchor.asOf, lte: asOf },
      },
      select: { amount: true, type: true },
    });
    const afterNet = after.reduce((sum, t) => sum + signed(t.type, decimalToNumber(t.amount)), 0);
    const anchorDay = anchor.asOf.toISOString().slice(0, 10);
    const source = anchor.statementId === null ? "יתרה שהזנת" : "יתרה מודפסת בדוח";

    return {
      balance: round2(anchor.balance + afterNet),
      basis: "statement",
      anchor: {
        statementId: anchor.statementId,
        fileName: anchor.fileName,
        coverageTo: anchorDay,
        closingBalance: round2(anchor.balance),
      },
      afterAnchorNet: round2(afterNet),
      afterAnchorCount: after.length,
      explanation:
        after.length === 0
          ? `${source} נכון ל-${anchorDay}`
          : `${source} נכון ל-${anchorDay}, בתוספת ${after.length} תנועות מאוחרות יותר`,
    };
  },

  /**
   * Recompute and persist. `current_balance` stays a denormalised copy so every
   * existing reader keeps working, but it is now always a full recomputation —
   * there is no increment path left that could drift.
   */
  async recompute(userId: number, accountId: number): Promise<DerivedBalance> {
    const derived = await this.derive(userId, accountId);
    await prisma.bankAccount.update({
      where: { id: accountId },
      data: { currentBalance: derived.balance },
    });
    return derived;
  },

  /** Recompute every account of a user — used after a backfill or a repair. */
  async recomputeAll(userId: number): Promise<void> {
    const accounts = await prisma.bankAccount.findMany({
      where: { userId },
      select: { id: true },
    });
    for (const account of accounts) {
      await this.recompute(userId, account.id);
    }
  },
};
