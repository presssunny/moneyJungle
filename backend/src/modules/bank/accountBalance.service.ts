import { prisma } from "../../config/database";
import { decimalToNumber, round2 } from "../../utils/money.utils";

/**
 * Account balance, derived — never accumulated: the newest printed closing
 * balance plus only what is dated after it, so re-importing an overlapping
 * statement cannot drift it. With no anchor at all it falls back to the
 * accumulated sum and SAYS so — an admitted estimate beats a false fact.
 */
export type BalanceBasis = "statement" | "accumulated";

export interface DerivedBalance {
  balance: number;
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
  account: { anchorBalance: unknown; anchorDate: Date | null }
): Promise<Anchor | null> {
  const statement = await prisma.bankStatementImport.findFirst({
    where: { userId, bankAccountId: accountId, closingBalance: { not: null } },
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
    account.anchorDate !== null && account.anchorBalance !== null
      ? {
          statementId: null,
          fileName: "יתרה שהוזנה ידנית",
          asOf: account.anchorDate,
          balance: decimalToNumber(account.anchorBalance as never),
        }
      : null;

  if (!fromStatement) return fromUser;
  if (!fromUser) return fromStatement;
  return fromUser.asOf > fromStatement.asOf ? fromUser : fromStatement;
}

export const accountBalanceService = {
  /** Compute the balance from scratch. Pure read — nothing is written here. */
  async derive(userId: number, accountId: number): Promise<DerivedBalance> {
    const account = await prisma.bankAccount.findFirst({
      where: { id: accountId, userId },
      select: { initialBalance: true, anchorBalance: true, anchorDate: true },
    });
    if (!account) throw new Error(`bank account ${accountId} not found for user ${userId}`);

    const anchor = await findAnchor(userId, accountId, account);

    if (!anchor) {
      // No statement ever reported a balance — the best we can do is the old
      // sum. Reported as "accumulated" so the UI never presents it as verified.
      const all = await prisma.bankTransaction.findMany({
        where: { userId, bankAccountId: accountId },
        select: { amount: true, type: true },
      });
      const net = all.reduce((sum, t) => sum + signed(t.type, decimalToNumber(t.amount)), 0);
      return {
        balance: round2(decimalToNumber(account.initialBalance) + net),
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
        transactionDate: { gt: anchor.asOf },
      },
      select: { amount: true, type: true },
    });
    const afterNet = after.reduce((sum, t) => sum + signed(t.type, decimalToNumber(t.amount)), 0);
    const asOf = anchor.asOf.toISOString().slice(0, 10);
    const source = anchor.statementId === null ? "יתרה שהזנת" : "יתרה מודפסת בדוח";

    return {
      balance: round2(anchor.balance + afterNet),
      basis: "statement",
      anchor: {
        statementId: anchor.statementId,
        fileName: anchor.fileName,
        coverageTo: asOf,
        closingBalance: round2(anchor.balance),
      },
      afterAnchorNet: round2(afterNet),
      afterAnchorCount: after.length,
      explanation:
        after.length === 0
          ? `${source} נכון ל-${asOf}`
          : `${source} נכון ל-${asOf}, בתוספת ${after.length} תנועות מאוחרות יותר`,
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
