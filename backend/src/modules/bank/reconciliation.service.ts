import { prisma } from "../../config/database";
import { ApiError } from "../../utils/ApiError";
import { decimalToNumber, round2 } from "../../utils/money.utils";
import { buildRuleCategorizer } from "../categories/categorization.service";
import { classifyBankLine } from "./bankParser.service";
import {
  BankResolution,
  DEBT_RESOLUTIONS,
  EXPENSE_RESOLUTIONS,
  RESOLUTION_LABELS,
} from "./bankResolution";
import { buildCreditCoverage } from "./creditCoverage.service";

/**
 * Bank reconciliation. Rows are never copied into incomes/loans/expenses — that
 * would double-count against the credit module (CLAUDE.md §4). Every row must end
 * with a resolution: `pending` is invisible in every total.
 */

// ---------- Income-type guessing (a suggestion; the user can change it) ----------
function guessIncomeType(description: string): string {
  const d = description;
  if (/קצב|בטוח\s*לאומי|ביטוח\s*לאומי|מזונות|נכות|אבטלה|הבטחת\s*הכנסה/.test(d)) return "allowance";
  if (/משכורת|שכר|משכ'|שכ"ע|העברת\s*משכורת/.test(d)) return "salary";
  if (/החזר\s*מס|מס\s*הכנסה|זיכוי\s*מס/.test(d)) return "refund";
  return "extra";
}

const INCOME_TYPE_LABELS: Record<string, string> = {
  salary: "משכורת",
  allowance: "קצבה",
  business: "עסק",
  refund: "החזר/זיכוי",
  extra: "הכנסה נוספת",
};

// ---------- Categories the resolver looks up by name ----------

/** Carries the cost of credit, so interest never hides inside ordinary spend. */
const FINANCING_CATEGORY = "ריבית ועמלות בנק";
/** A card bill nothing itemizes: coarse by nature, so it says so by name. */
const UNITEMIZED_CARD_CATEGORY = "חיוב אשראי ללא פירוט";

// ---------- Client-facing row shape ----------
export interface ReconcileRow {
  id: number;
  date: string;
  description: string;
  amount: number;
  type: string;
  lineKind: string;
  loanRef: string | null;
  reconcileStatus: string;
  resolution: BankResolution | null;
  resolutionLabel: string | null;
  reconcileNote: string | null;
  /** True when a human should look at this row even though it is resolved. */
  needsReview: boolean;
  linkedIncomeId: number | null;
  linkedLoanId: number | null;
  linkedExpenseId: number | null;
  suggestedIncomeType?: string;
  suggestedIncomeLabel?: string;
}

export interface ReconcileLoanGroup {
  loanRef: string | null;
  label: string;
  principalTotal: number;
  interestTotal: number;
  mixedTotal: number;
  count: number;
  rows: ReconcileRow[];
}

export interface ReconciliationView {
  summary: {
    total: number;
    pending: number;
    done: number;
    excluded: number;
    /** Rows with no resolution at all — must always be 0 after a resolve pass. */
    unresolved: number;
    needsReview: number;
    income: number;
    spend: number;
    financingNet: number;
    debtReduction: number;
    unitemizedCard: number;
    settledCard: number;
    internalTransfer: number;
  };
  /** Everything, grouped by what the money turned out to be. */
  byResolution: Array<{
    resolution: BankResolution | "unresolved";
    label: string;
    count: number;
    total: number;
    rows: ReconcileRow[];
  }>;
  needsReview: ReconcileRow[];
  incomeCandidates: ReconcileRow[];
  loanGroups: ReconcileLoanGroup[];
  standardSpend: ReconcileRow[];
  financingLines: ReconcileRow[];
  creditCardPayments: ReconcileRow[];
  done: ReconcileRow[];
}

type RawTx = {
  id: number;
  transactionDate: Date;
  description: string | null;
  amount: unknown;
  type: string;
  lineKind: string;
  loanRef: string | null;
  reconcileStatus: string;
  resolution: string | null;
  reconcileNote: string | null;
  linkedIncomeId: number | null;
  linkedLoanId: number | null;
  linkedExpenseId: number | null;
};

/**
 * Resolutions that are correct but coarse or unverifiable from the statement
 * alone, so the screen keeps showing them: a card bill nothing itemizes, a loan
 * whose terms are unknown, a repayment the bank never split.
 */
const REVIEW_RESOLUTIONS: ReadonlySet<BankResolution> = new Set<BankResolution>([
  "credit_card_unitemized",
  "loan_drawdown",
  "loan_repayment_unsplit",
]);

/** Marks a row the resolver promoted but flagged in its note. */
const REVIEW_NOTE_MARK = "לבדיקה:";

function isReviewRow(t: { resolution: string | null; reconcileNote: string | null }): boolean {
  if (t.resolution === null) return true;
  if (REVIEW_RESOLUTIONS.has(t.resolution as BankResolution)) return true;
  return (t.reconcileNote ?? "").startsWith(REVIEW_NOTE_MARK);
}

function toRow(t: RawTx): ReconcileRow {
  const description = t.description ?? "";
  const resolution = (t.resolution as BankResolution | null) ?? null;
  const row: ReconcileRow = {
    id: t.id,
    date: t.transactionDate.toISOString().slice(0, 10),
    description,
    amount: decimalToNumber(t.amount as never),
    type: t.type,
    lineKind: t.lineKind,
    loanRef: t.loanRef,
    reconcileStatus: t.reconcileStatus,
    resolution,
    resolutionLabel: resolution ? RESOLUTION_LABELS[resolution] : null,
    reconcileNote: t.reconcileNote,
    needsReview: isReviewRow(t),
    linkedIncomeId: t.linkedIncomeId,
    linkedLoanId: t.linkedLoanId,
    linkedExpenseId: t.linkedExpenseId,
  };
  if (t.type === "deposit" && t.lineKind !== "interest_credit" && t.lineKind !== "loan_drawdown") {
    const guess = guessIncomeType(description);
    row.suggestedIncomeType = guess;
    row.suggestedIncomeLabel = INCOME_TYPE_LABELS[guess] ?? guess;
  }
  return row;
}

const LOAN_KINDS = new Set(["loan_principal", "loan_interest", "loan_mixed"]);

// ---------- Internal transfers and atypical credits ----------

/** Same amount out and back within a few days may be one internal move. */
const ROUND_TRIP_MAX_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Wording that means "money moved between accounts". BOTH legs must read like a
 * transfer before a pair is netted: a plain "זיכוי" five days after a 7,000
 * transfer out is an ordinary receipt, not the money coming back.
 */
const INTERNAL_TRANSFER_TEXT = /העברה|העברת|לחשבון|מהחשבון|בין\s*חשבונות|הפקדה\s*לחשבון|מסלקה/;

interface PairRow {
  id: number;
  transactionDate: Date;
  description: string | null;
  amount: number;
  type: string;
  lineKind: string;
}

/**
 * Ids of legs that form one internal transfer. Every status is considered when
 * matching, so a pair stays recognisable after one leg was dealt with, but only
 * the ids are returned — the caller decides what to do with them.
 */
function findInternalTransferIds(rows: PairRow[]): Set<number> {
  const held = new Set<number>();
  const takenDeposits = new Set<number>();
  const standard = rows.filter(
    (r) => r.lineKind === "standard" && INTERNAL_TRANSFER_TEXT.test((r.description ?? "").trim())
  );
  for (const withdrawal of standard) {
    if (withdrawal.type !== "withdrawal") continue;
    let match: PairRow | null = null;
    let bestGap = Number.POSITIVE_INFINITY;
    for (const deposit of standard) {
      if (deposit.id === withdrawal.id || takenDeposits.has(deposit.id)) continue;
      if (deposit.type !== "deposit") continue;
      if (Math.abs(deposit.amount - withdrawal.amount) > 0.005) continue;
      const gap = Math.abs(deposit.transactionDate.getTime() - withdrawal.transactionDate.getTime()) / DAY_MS;
      if (gap > ROUND_TRIP_MAX_DAYS || gap >= bestGap) continue;
      bestGap = gap;
      match = deposit;
    }
    if (!match) continue;
    takenDeposits.add(match.id);
    held.add(withdrawal.id);
    held.add(match.id);
  }
  return held;
}

/**
 * A credit this many times the typical one is still income, but flagged: with no
 * wording to go on, that is also what a drawdown or an own-account transfer
 * looks like.
 */
const ATYPICAL_DEPOSIT_RATIO = 10;

function findAtypicalDepositIds(candidates: Array<{ id: number; amount: number }>): Set<number> {
  const flagged = new Set<number>();
  if (candidates.length < 3) return flagged;
  for (const row of candidates) {
    const others = candidates.filter((o) => o.id !== row.id).map((o) => o.amount).sort((a, b) => a - b);
    const median = others[Math.floor(others.length / 2)]!;
    if (median > 0 && row.amount / median >= ATYPICAL_DEPOSIT_RATIO) flagged.add(row.id);
  }
  return flagged;
}

// ---------- Resolve-pass result ----------
export interface ResolveResult {
  /** Rows whose resolution/records changed in this pass. */
  changed: number;
  income: { count: number; total: number };
  spend: { count: number; total: number };
  financingCharged: { count: number; total: number };
  financingCredited: { count: number; total: number };
  debtReduction: { count: number; total: number };
  loanUnsplit: { count: number; total: number };
  loanDrawdown: { count: number; total: number };
  cardSettled: { count: number; total: number };
  cardUnitemized: { count: number; total: number };
  internalTransfer: { count: number; total: number };
  manualExcluded: { count: number; total: number };
  /** Must be 0: a row the resolver could not give a meaning to. */
  unresolved: { count: number; total: number };
}

const emptyBucket = () => ({ count: 0, total: 0 });

const emptyResolveResult = (): ResolveResult => ({
  changed: 0,
  income: emptyBucket(),
  spend: emptyBucket(),
  financingCharged: emptyBucket(),
  financingCredited: emptyBucket(),
  debtReduction: emptyBucket(),
  loanUnsplit: emptyBucket(),
  loanDrawdown: emptyBucket(),
  cardSettled: emptyBucket(),
  cardUnitemized: emptyBucket(),
  internalTransfer: emptyBucket(),
  manualExcluded: emptyBucket(),
  unresolved: emptyBucket(),
});

const RESULT_BUCKET: Record<BankResolution, keyof Omit<ResolveResult, "changed">> = {
  income: "income",
  expense: "spend",
  financing_charge: "financingCharged",
  financing_credit: "financingCredited",
  debt_reduction: "debtReduction",
  loan_repayment_unsplit: "loanUnsplit",
  loan_drawdown: "loanDrawdown",
  credit_card_settled: "cardSettled",
  credit_card_unitemized: "cardUnitemized",
  internal_transfer: "internalTransfer",
  manual_excluded: "manualExcluded",
};

/** The record a resolution needs in another table, if any. */
type TargetRecord = "income" | "expense" | "none";

interface ResolutionTarget {
  resolution: BankResolution;
  status: "done" | "excluded";
  note: string;
  record: TargetRecord;
  /** Expense only: which category, and whether the amount is negative. */
  categoryId?: number | null;
  negative?: boolean;
}

async function requireTx(userId: number, id: number) {
  const tx = await prisma.bankTransaction.findFirst({ where: { id, userId } });
  if (!tx) throw ApiError.notFound("התנועה הבנקאית לא נמצאה");
  return tx;
}

interface ResolverRow {
  id: number;
  transactionDate: Date;
  description: string | null;
  amount: number;
  type: string;
  lineKind: string;
  loanRef: string | null;
  categoryId: number | null;
  reconcileStatus: string;
  resolution: string | null;
  reconcileNote: string | null;
  linkedIncomeId: number | null;
  linkedLoanId: number | null;
  linkedExpenseId: number | null;
}

export const reconciliationService = {
  /**
   * Recompute lineKind/loanRef from the description for every row the user has not
   * resolved by hand. Idempotent — safe to run repeatedly. This back-fills rows
   * imported before a classification rule existed.
   */
  async backfillClassification(userId: number): Promise<number> {
    const rows = await prisma.bankTransaction.findMany({
      where: { userId, resolution: { not: "manual_excluded" } },
      select: { id: true, description: true, type: true, lineKind: true, loanRef: true },
    });
    let updated = 0;
    for (const r of rows) {
      const type = r.type === "deposit" ? "deposit" : "withdrawal";
      const { lineKind, loanRef } = classifyBankLine(r.description, type);
      if (lineKind !== r.lineKind || (loanRef ?? null) !== (r.loanRef ?? null)) {
        await prisma.bankTransaction.update({ where: { id: r.id }, data: { lineKind, loanRef } });
        updated += 1;
      }
    }
    return updated;
  },

  /**
   * Give every row a meaning and make the other tables agree with it. Idempotent:
   * when a decision changes (a card bill becomes itemized once its statement
   * lands) the earlier record is removed. `manual_excluded` is never touched.
   */
  async resolveAll(userId: number): Promise<ResolveResult> {
    await this.backfillClassification(userId);

    const [rawRows, coverage, categorize, financingCategoryId, unitemizedCategoryId] =
      await Promise.all([
        prisma.bankTransaction.findMany({
          where: { userId },
          orderBy: [{ transactionDate: "asc" }, { id: "asc" }],
          select: {
            id: true,
            transactionDate: true,
            description: true,
            amount: true,
            type: true,
            lineKind: true,
            loanRef: true,
            categoryId: true,
            reconcileStatus: true,
            resolution: true,
            reconcileNote: true,
            linkedIncomeId: true,
            linkedLoanId: true,
            linkedExpenseId: true,
          },
        }),
        buildCreditCoverage(userId),
        buildRuleCategorizer(userId),
        categoryIdByName(userId, FINANCING_CATEGORY),
        categoryIdByName(userId, UNITEMIZED_CARD_CATEGORY),
      ]);

    const rows: ResolverRow[] = rawRows.map((r) => ({ ...r, amount: decimalToNumber(r.amount) }));
    const internalTransferIds = findInternalTransferIds(rows);
    const atypicalIds = findAtypicalDepositIds(
      rows.filter(
        (r) => r.type === "deposit" && r.lineKind === "standard" && !internalTransferIds.has(r.id)
      )
    );

    const result = emptyResolveResult();
    for (const row of rows) {
      if (row.resolution === "manual_excluded") {
        addToBucket(result, "manual_excluded", row.amount);
        continue;
      }

      const target = decideTarget(row, {
        coverage,
        categorize,
        financingCategoryId,
        unitemizedCategoryId,
        internalTransferIds,
        atypicalIds,
      });

      const changed = await applyTarget(userId, row, target);
      if (changed) result.changed += 1;
      addToBucket(result, target.resolution, row.amount);
    }

    const unresolved = await prisma.bankTransaction.aggregate({
      where: { userId, resolution: null },
      _sum: { amount: true },
      _count: { _all: true },
    });
    result.unresolved = {
      count: unresolved._count._all,
      total: round2(decimalToNumber(unresolved._sum.amount)),
    };
    return result;
  },

  /** Kept for callers/routes that predate the resolver naming. */
  async autoReconcile(userId: number): Promise<ResolveResult> {
    return this.resolveAll(userId);
  },

  async getReconciliation(userId: number): Promise<ReconciliationView> {
    await this.resolveAll(userId);
    const txs = (await prisma.bankTransaction.findMany({
      where: { userId },
      orderBy: [{ transactionDate: "asc" }, { id: "asc" }],
      select: {
        id: true,
        transactionDate: true,
        description: true,
        amount: true,
        type: true,
        lineKind: true,
        loanRef: true,
        reconcileStatus: true,
        resolution: true,
        reconcileNote: true,
        linkedIncomeId: true,
        linkedLoanId: true,
        linkedExpenseId: true,
      },
    })) as RawTx[];

    const rows = txs.map(toRow);
    const pending = rows.filter((r) => r.reconcileStatus === "pending");
    const totalOf = (list: ReconcileRow[]) => round2(list.reduce((sum, r) => sum + r.amount, 0));
    const withResolution = (resolution: BankResolution) =>
      rows.filter((r) => r.resolution === resolution);

    // Grouped by meaning: this is the view that answers "which rows make up this
    // figure?" for every number the dashboard shows.
    const order: Array<BankResolution | "unresolved"> = [
      "income",
      "expense",
      "financing_charge",
      "financing_credit",
      "credit_card_unitemized",
      "debt_reduction",
      "loan_repayment_unsplit",
      "loan_drawdown",
      "credit_card_settled",
      "internal_transfer",
      "manual_excluded",
      "unresolved",
    ];
    const byResolution = order
      .map((resolution) => {
        const group =
          resolution === "unresolved"
            ? rows.filter((r) => r.resolution === null)
            : withResolution(resolution);
        return {
          resolution,
          label:
            resolution === "unresolved"
              ? "ללא סיווג — דורש טיפול"
              : RESOLUTION_LABELS[resolution],
          count: group.length,
          total: totalOf(group),
          rows: group,
        };
      })
      .filter((group) => group.count > 0);

    const financingNet = round2(
      totalOf(withResolution("financing_charge")) - totalOf(withResolution("financing_credit"))
    );

    const incomeCandidates = pending.filter(
      (r) => r.type === "deposit" && r.lineKind !== "interest_credit"
    );
    const loanRows = rows.filter(
      (r) => LOAN_KINDS.has(r.lineKind) && r.resolution !== "financing_charge"
    );
    const standardSpend = pending.filter((r) => r.type === "withdrawal" && r.lineKind === "standard");
    const financingLines = rows.filter(
      (r) => r.resolution === "financing_charge" || r.resolution === "financing_credit"
    );
    const creditCardPayments = rows.filter((r) => r.lineKind === "credit_card_payment");
    const done = rows.filter((r) => r.reconcileStatus === "done");

    // Group loan-payment rows by loan reference. Principal lines often carry no
    // number in the statement, so they collect under a "no number" group.
    const groupsMap = new Map<string, ReconcileLoanGroup>();
    for (const r of loanRows) {
      const key = r.loanRef ?? "__none__";
      let g = groupsMap.get(key);
      if (!g) {
        g = {
          loanRef: r.loanRef,
          label: r.loanRef ? `הלוואה ${r.loanRef}` : "תשלומי קרן ללא מספר הלוואה בדוח",
          principalTotal: 0,
          interestTotal: 0,
          mixedTotal: 0,
          count: 0,
          rows: [],
        };
        groupsMap.set(key, g);
      }
      if (r.lineKind === "loan_principal") g.principalTotal = round2(g.principalTotal + r.amount);
      else if (r.lineKind === "loan_interest") g.interestTotal = round2(g.interestTotal + r.amount);
      else if (r.lineKind === "loan_mixed") g.mixedTotal = round2(g.mixedTotal + r.amount);
      g.count += 1;
      g.rows.push(r);
    }
    const loanGroups = [...groupsMap.values()].sort((a, b) => {
      if (a.loanRef === null) return 1;
      if (b.loanRef === null) return -1;
      return a.loanRef.localeCompare(b.loanRef);
    });

    return {
      summary: {
        total: rows.length,
        pending: pending.length,
        done: done.length,
        excluded: rows.filter((r) => r.reconcileStatus === "excluded").length,
        unresolved: rows.filter((r) => r.resolution === null).length,
        needsReview: rows.filter((r) => r.needsReview).length,
        income: totalOf(withResolution("income")),
        spend: totalOf(withResolution("expense")),
        financingNet,
        debtReduction: round2(
          totalOf(withResolution("debt_reduction")) + totalOf(withResolution("loan_repayment_unsplit"))
        ),
        unitemizedCard: totalOf(withResolution("credit_card_unitemized")),
        settledCard: totalOf(withResolution("credit_card_settled")),
        internalTransfer: totalOf(withResolution("internal_transfer")),
      },
      byResolution,
      needsReview: rows.filter((r) => r.needsReview),
      incomeCandidates,
      loanGroups,
      standardSpend,
      financingLines,
      creditCardPayments,
      done,
    };
  },

  /**
   * Loan activity as the statement reports it, grouped per loan reference, so a
   * loan whose terms were never entered still shows its real repayments. Derived
   * from `bank_transactions`, so it cannot drift from the reconciliation screen.
   */
  async loanActivityFromStatement(userId: number) {
    const rows = await prisma.bankTransaction.findMany({
      where: {
        userId,
        OR: [
          // `loan_fee` is included so an early-repayment charge appears beside the
          // loan it closed, instead of only inside the financing total.
          { lineKind: { in: ["loan_principal", "loan_interest", "loan_mixed", "loan_drawdown", "loan_fee"] } },
          { resolution: { in: ["debt_reduction", "loan_repayment_unsplit", "loan_drawdown"] } },
        ],
      },
      orderBy: [{ transactionDate: "asc" }, { id: "asc" }],
      select: {
        id: true,
        transactionDate: true,
        description: true,
        amount: true,
        type: true,
        lineKind: true,
        loanRef: true,
        resolution: true,
        reconcileNote: true,
        linkedLoanId: true,
      },
    });

    interface Group {
      loanRef: string | null;
      label: string;
      principalPaid: number;
      interestPaid: number;
      interestRefunded: number;
      unsplitPaid: number;
      drawdown: number;
      feesPaid: number;
      linkedLoanId: number | null;
      months: string[];
      rows: Array<{
        id: number;
        date: string;
        description: string;
        amount: number;
        lineKind: string;
        resolution: string | null;
        note: string | null;
      }>;
    }

    const groups = new Map<string, Group>();
    for (const r of rows) {
      const key = r.loanRef ?? (r.lineKind === "loan_drawdown" ? "__drawdown__" : "__none__");
      let g = groups.get(key);
      if (!g) {
        g = {
          loanRef: r.loanRef,
          label: r.loanRef
            ? `הלוואה ${r.loanRef}`
            : r.lineKind === "loan_drawdown"
              ? "הלוואות שהתקבלו — טרם הוגדרו"
              : "תשלומי הלוואה ללא מספר בדוח",
          principalPaid: 0,
          interestPaid: 0,
          interestRefunded: 0,
          unsplitPaid: 0,
          drawdown: 0,
          feesPaid: 0,
          linkedLoanId: r.linkedLoanId,
          months: [],
          rows: [],
        };
        groups.set(key, g);
      }
      const amount = decimalToNumber(r.amount);
      const isIn = r.type === "deposit";
      if (r.lineKind === "loan_principal" && !isIn) g.principalPaid = round2(g.principalPaid + amount);
      else if (r.lineKind === "loan_mixed" && !isIn) g.unsplitPaid = round2(g.unsplitPaid + amount);
      else if (r.lineKind === "loan_interest" && !isIn) g.interestPaid = round2(g.interestPaid + amount);
      else if (r.lineKind === "loan_interest" && isIn)
        g.interestRefunded = round2(g.interestRefunded + amount);
      else if (r.lineKind === "loan_drawdown") g.drawdown = round2(g.drawdown + amount);
      else if (r.lineKind === "loan_fee" && !isIn) g.feesPaid = round2(g.feesPaid + amount);

      const month = r.transactionDate.toISOString().slice(0, 7);
      if (!g.months.includes(month)) g.months.push(month);
      if (g.linkedLoanId === null) g.linkedLoanId = r.linkedLoanId;
      g.rows.push({
        id: r.id,
        date: r.transactionDate.toISOString().slice(0, 10),
        description: r.description ?? "",
        amount,
        lineKind: r.lineKind,
        resolution: r.resolution,
        note: r.reconcileNote,
      });
    }

    const items = [...groups.values()].sort((a, b) => {
      if (a.loanRef === null) return 1;
      if (b.loanRef === null) return -1;
      return a.loanRef.localeCompare(b.loanRef);
    });

    const totals = {
      principalPaid: round2(items.reduce((s, g) => s + g.principalPaid, 0)),
      interestPaid: round2(items.reduce((s, g) => s + g.interestPaid, 0)),
      interestRefunded: round2(items.reduce((s, g) => s + g.interestRefunded, 0)),
      unsplitPaid: round2(items.reduce((s, g) => s + g.unsplitPaid, 0)),
      drawdown: round2(items.reduce((s, g) => s + g.drawdown, 0)),
      feesPaid: round2(items.reduce((s, g) => s + g.feesPaid, 0)),
      /** Everything that lowered debt: principal + repayments with no split. */
      debtReduction: round2(items.reduce((s, g) => s + g.principalPaid + g.unsplitPaid, 0)),
    };
    return { groups: items, totals };
  },

  /** Promote a deposit into a real Income record, linked back to the bank row. */
  async linkIncome(userId: number, transactionId: number, body: { type: string; description?: string | null }) {
    const tx = await requireTx(userId, transactionId);
    if (tx.type !== "deposit") throw ApiError.badRequest("רק הפקדה יכולה להפוך להכנסה");
    if (tx.linkedIncomeId) throw ApiError.conflict("התנועה כבר שויכה להכנסה");
    const income = await prisma.income.create({
      data: {
        userId,
        amount: decimalToNumber(tx.amount),
        type: body.type,
        description: body.description ?? tx.description ?? null,
        incomeDate: tx.transactionDate,
      },
    });
    await prisma.bankTransaction.update({
      where: { id: tx.id },
      data: {
        reconcileStatus: "done",
        resolution: "income",
        reconcileNote: "סווג להכנסה ידנית",
        linkedIncomeId: income.id,
      },
    });
    return income;
  },

  /**
   * Promote a standard withdrawal into an Expense (source = bank_import), so it
   * shows in the expenses/dashboard figures. Credit-card and financing lines are
   * refused here — they must not become ordinary spend.
   */
  async linkExpense(userId: number, transactionId: number, body: { categoryId?: number | null }) {
    const tx = await requireTx(userId, transactionId);
    if (tx.type !== "withdrawal" || tx.lineKind !== "standard")
      throw ApiError.badRequest("רק משיכה רגילה יכולה להפוך להוצאה שוטפת");
    if (tx.linkedExpenseId) throw ApiError.conflict("התנועה כבר שויכה להוצאה");
    const expense = await prisma.expense.create({
      data: {
        userId,
        amount: decimalToNumber(tx.amount),
        categoryId: body.categoryId ?? tx.categoryId ?? null,
        businessName: tx.description ?? null,
        description: tx.description ?? null,
        expenseDate: tx.transactionDate,
        source: "bank_import",
      },
    });
    await prisma.bankTransaction.update({
      where: { id: tx.id },
      data: {
        reconcileStatus: "done",
        resolution: "expense",
        reconcileNote: "סווג להוצאה ידנית",
        linkedExpenseId: expense.id,
      },
    });
    return expense;
  },

  /**
   * Create a Loan from a detected group, or link its rows to an existing one.
   * Original amount, rate and term come from the user — a statement line cannot
   * supply them. Linking adds the loan; it never re-labels the rows.
   */
  async linkLoan(
    userId: number,
    body: {
      loanId?: number;
      transactionIds: number[];
      loanName?: string;
      loanType?: string;
      lenderName?: string | null;
      originalAmount?: number;
      currentBalance?: number;
      annualInterestRate?: number;
      monthlyPayment?: number;
      startDate?: string;
    }
  ) {
    const txs = await prisma.bankTransaction.findMany({
      where: { id: { in: body.transactionIds }, userId },
    });
    if (txs.length === 0) throw ApiError.badRequest("לא נבחרו תנועות");

    let loanId = body.loanId;
    if (loanId) {
      const existing = await prisma.loan.findFirst({ where: { id: loanId, userId } });
      if (!existing) throw ApiError.notFound("ההלוואה לא נמצאה");
    } else {
      // A drawdown states the loan's own amount, so it is the one case where the
      // statement itself supplies the opening balance.
      const drawdown = txs.find((t) => t.lineKind === "loan_drawdown");
      const drawdownAmount = drawdown ? decimalToNumber(drawdown.amount) : undefined;
      const created = await prisma.loan.create({
        data: {
          userId,
          loanName: body.loanName ?? "הלוואה מיובאת",
          loanType: body.loanType ?? "bank",
          lenderName: body.lenderName ?? null,
          originalAmount: body.originalAmount ?? drawdownAmount ?? 0,
          currentBalance: body.currentBalance ?? body.originalAmount ?? drawdownAmount ?? 0,
          annualInterestRate: body.annualInterestRate ?? 0,
          monthlyPayment: body.monthlyPayment ?? 0,
          startDate: body.startDate ? new Date(body.startDate) : txs[0]!.transactionDate,
        },
      });
      loanId = created.id;
    }

    await prisma.bankTransaction.updateMany({
      where: { id: { in: txs.map((t) => t.id) }, userId },
      data: { reconcileStatus: "done", linkedLoanId: loanId },
    });
    return prisma.loan.findFirst({ where: { id: loanId, userId } });
  },

  /**
   * Set a row aside by hand (an internal move the resolver could not see, a line
   * the user knows is not theirs). Any record it created is removed, and the row
   * is marked `manual_excluded` so the resolver leaves it alone from now on.
   */
  async exclude(userId: number, transactionId: number, note?: string) {
    const tx = await requireTx(userId, transactionId);
    await prisma.$transaction(async (db) => {
      if (tx.linkedIncomeId) await db.income.deleteMany({ where: { id: tx.linkedIncomeId, userId } });
      if (tx.linkedExpenseId) await db.expense.deleteMany({ where: { id: tx.linkedExpenseId, userId } });
      await db.bankTransaction.update({
        where: { id: transactionId },
        data: {
          reconcileStatus: "excluded",
          resolution: "manual_excluded",
          reconcileNote: note ?? "הוחרג ידנית על ידי המשתמשת",
          linkedIncomeId: null,
          linkedLoanId: null,
          linkedExpenseId: null,
        },
      });
    });
  },

  /**
   * Undo a reconciliation: delete the record it created (so nothing is left
   * double-counted) and hand the row back to the resolver.
   */
  async reset(userId: number, transactionId: number) {
    const tx = await requireTx(userId, transactionId);
    await prisma.$transaction(async (db) => {
      if (tx.linkedIncomeId) await db.income.deleteMany({ where: { id: tx.linkedIncomeId, userId } });
      if (tx.linkedExpenseId) await db.expense.deleteMany({ where: { id: tx.linkedExpenseId, userId } });
      // A loan may back several rows; only delete it when this is its last link.
      if (tx.linkedLoanId) {
        const others = await db.bankTransaction.count({
          where: { userId, linkedLoanId: tx.linkedLoanId, id: { not: tx.id } },
        });
        if (others === 0) await db.loan.deleteMany({ where: { id: tx.linkedLoanId, userId } });
      }
      await db.bankTransaction.update({
        where: { id: tx.id },
        data: {
          reconcileStatus: "pending",
          resolution: null,
          reconcileNote: null,
          linkedIncomeId: null,
          linkedLoanId: null,
          linkedExpenseId: null,
        },
      });
    });
    // Give it a meaning again straight away, so a reset row is never left invisible.
    await this.resolveAll(userId);
  },
};

// ---------- Resolver internals ----------

async function categoryIdByName(userId: number, name: string): Promise<number | null> {
  const category = await prisma.category.findFirst({
    where: { name, OR: [{ userId }, { userId: null }] },
    select: { id: true },
  });
  return category?.id ?? null;
}

function addToBucket(result: ResolveResult, resolution: BankResolution, amount: number): void {
  const bucket = result[RESULT_BUCKET[resolution]];
  bucket.count += 1;
  bucket.total = round2(bucket.total + amount);
}

interface DecideContext {
  coverage: Awaited<ReturnType<typeof buildCreditCoverage>>;
  categorize: (text: string) => number | null;
  financingCategoryId: number | null;
  unitemizedCategoryId: number | null;
  internalTransferIds: Set<number>;
  atypicalIds: Set<number>;
}

/**
 * The whole classification policy, in one place: row in → meaning out. Pure, so
 * it can be reasoned about (and tested) without touching the database.
 */
function decideTarget(row: ResolverRow, ctx: DecideContext): ResolutionTarget {
  const isIn = row.type === "deposit";

  // Interest, both directions. A refund is a negative financing expense — real
  // money back on a real cost — and never income (CLAUDE.md §5).
  if (row.lineKind === "loan_interest" || row.lineKind === "overdraft_interest") {
    if (isIn) {
      return {
        resolution: "financing_credit",
        status: "done",
        note: "זיכוי ריבית — נרשם כהוצאה מימונית שלילית, לא כהכנסה",
        record: "expense",
        categoryId: ctx.financingCategoryId,
        negative: true,
      };
    }
    return {
      resolution: "financing_charge",
      status: "done",
      note: "ריבית — הוצאה מימונית, לא הוצאה שוטפת",
      record: "expense",
      categoryId: ctx.financingCategoryId,
    };
  }
  if (row.lineKind === "interest_credit") {
    return {
      resolution: "financing_credit",
      status: "done",
      note: "זיכוי ריבית — נרשם כהוצאה מימונית שלילית, לא כהכנסה",
      record: "expense",
      categoryId: ctx.financingCategoryId,
      negative: true,
    };
  }

  // Closing a loan early costs a fee. It is a cost OF THE CREDIT, so it belongs
  // with interest in financing — not among the household's ordinary spending,
  // where it would look like a 148 ₪ purchase nobody made.
  if (row.lineKind === "loan_fee") {
    return {
      resolution: "financing_charge",
      status: "done",
      note: "עמלת פירעון מוקדם — הוצאה מימונית של ההלוואה, לא הוצאה שוטפת",
      record: "expense",
      categoryId: ctx.financingCategoryId,
      negative: isIn,
    };
  }

  // Loan principal: debt goes down, nothing was consumed. Never an expense.
  if (row.lineKind === "loan_principal") {
    return {
      resolution: "debt_reduction",
      status: "done",
      note: "תשלום קרן — הקטנת חוב, לא הוצאה שוטפת. מוצג בטאב הלוואות",
      record: "none",
    };
  }

  // Combined repayment with no breakdown in the statement. Its own bucket: any
  // split we invented would be a number the bank never printed.
  if (row.lineKind === "loan_mixed") {
    return {
      resolution: "loan_repayment_unsplit",
      status: "done",
      note: `${REVIEW_NOTE_MARK} תשלום הלוואה ${row.loanRef ?? ""} ללא פירוט קרן/ריבית בדוח — לא נספר כהוצאה שוטפת`.trim(),
      record: "none",
    };
  }

  // A loan received creates a liability, not income.
  if (row.lineKind === "loan_drawdown") {
    return {
      resolution: "loan_drawdown",
      status: "done",
      note: `${REVIEW_NOTE_MARK} קבלת הלוואה — התחייבות ולא הכנסה. יש להשלים את תנאי ההלוואה בטאב הלוואות`,
      record: "none",
    };
  }

  // Card settlements: excluded only when that card is really itemized elsewhere.
  if (row.lineKind === "credit_card_payment") {
    const verdict = ctx.coverage.verdictFor(row);
    if (verdict.covered) {
      return {
        resolution: "credit_card_settled",
        status: "excluded",
        note: verdict.reason,
        record: "none",
      };
    }
    return {
      resolution: "credit_card_unitemized",
      status: "done",
      note: `${REVIEW_NOTE_MARK} ${verdict.reason}`,
      record: "expense",
      categoryId: ctx.unitemizedCategoryId,
    };
  }

  // Internal transfer: both legs held out, so neither invents income nor spend.
  if (ctx.internalTransferIds.has(row.id)) {
    return {
      resolution: "internal_transfer",
      status: "excluded",
      note: "העברה פנימית בין חשבונות — שני צדי התנועה מוחרגים",
      record: "none",
    };
  }

  if (isIn) {
    const atypical = ctx.atypicalIds.has(row.id);
    return {
      resolution: "income",
      status: "done",
      note: atypical
        ? `${REVIEW_NOTE_MARK} תקבול חריג בגודלו מול שאר התקבולים — סווג כהכנסה לפי עמודת הזכות. אם זו קבלת הלוואה או העברה מחשבון אחר, יש לשנות ידנית`
        : "הפקדה בעמודת הזכות — סווג כהכנסה",
      record: "income",
    };
  }

  return {
    resolution: "expense",
    status: "done",
    note: "משיכה בעמודת החובה — סווג כהוצאה שוטפת",
    record: "expense",
    categoryId: ctx.categorize(row.description ?? "") ?? row.categoryId,
  };
}

/**
 * Make the database agree with a decision; returns whether anything changed, so
 * a re-run on settled data is silent. Stale records are deleted before the right
 * one is created — a row holding two links is how a double count starts.
 */
async function applyTarget(userId: number, row: ResolverRow, target: ResolutionTarget): Promise<boolean> {
  let changed = false;
  const wantedAmount = target.negative ? round2(-row.amount) : row.amount;

  // Drop records the new meaning does not call for.
  if (row.linkedIncomeId !== null && target.record !== "income") {
    await prisma.income.deleteMany({ where: { id: row.linkedIncomeId, userId } });
    row.linkedIncomeId = null;
    changed = true;
  }
  if (row.linkedExpenseId !== null && target.record !== "expense") {
    await prisma.expense.deleteMany({ where: { id: row.linkedExpenseId, userId } });
    row.linkedExpenseId = null;
    changed = true;
  }

  // Create or correct the record the meaning does call for.
  if (target.record === "income" && row.linkedIncomeId === null) {
    const income = await prisma.income.create({
      data: {
        userId,
        amount: wantedAmount,
        type: guessIncomeType(row.description ?? ""),
        description: row.description ?? null,
        incomeDate: row.transactionDate,
      },
    });
    row.linkedIncomeId = income.id;
    changed = true;
  }
  if (target.record === "expense") {
    if (row.linkedExpenseId === null) {
      const expense = await prisma.expense.create({
        data: {
          userId,
          amount: wantedAmount,
          categoryId: target.categoryId ?? null,
          businessName: row.description ?? null,
          description: row.description ?? null,
          expenseDate: row.transactionDate,
          source: "bank_import",
        },
      });
      row.linkedExpenseId = expense.id;
      changed = true;
    } else {
      // Correct an existing record: the amount sign (a credit re-read as a
      // refund) and a category that was never filled. A category the user chose
      // by hand is left alone — only a null one is filled in.
      const existing = await prisma.expense.findFirst({
        where: { id: row.linkedExpenseId, userId },
        select: { id: true, amount: true, categoryId: true },
      });
      if (existing) {
        const data: { amount?: number; categoryId?: number } = {};
        if (round2(decimalToNumber(existing.amount)) !== wantedAmount) data.amount = wantedAmount;
        if (existing.categoryId === null && target.categoryId != null) data.categoryId = target.categoryId;
        if (Object.keys(data).length > 0) {
          await prisma.expense.update({ where: { id: existing.id }, data });
          changed = true;
        }
      }
    }
  }

  // Record the meaning on the bank row itself.
  if (
    row.reconcileStatus !== target.status ||
    row.resolution !== target.resolution ||
    row.reconcileNote !== target.note ||
    changed
  ) {
    await prisma.bankTransaction.update({
      where: { id: row.id },
      data: {
        reconcileStatus: target.status,
        resolution: target.resolution,
        reconcileNote: target.note,
        linkedIncomeId: row.linkedIncomeId,
        linkedExpenseId: row.linkedExpenseId,
      },
    });
    changed =
      changed ||
      row.reconcileStatus !== target.status ||
      row.resolution !== target.resolution ||
      row.reconcileNote !== target.note;
  }
  return changed;
}

/** One-line Hebrew summary of a resolve pass, for the import log. */
export function describeResolveResult(result: ResolveResult): string {
  const parts = [
    `הכנסות ${result.income.total.toFixed(2)} (${result.income.count})`,
    `הוצאות שוטפות ${result.spend.total.toFixed(2)} (${result.spend.count})`,
    `ריבית ${result.financingCharged.total.toFixed(2)} (${result.financingCharged.count})`,
    `זיכויי ריבית ${result.financingCredited.total.toFixed(2)} (${result.financingCredited.count})`,
    `קרן/הקטנת חוב ${result.debtReduction.total.toFixed(2)} (${result.debtReduction.count})`,
    `תשלומי הלוואה ללא פירוט ${result.loanUnsplit.total.toFixed(2)} (${result.loanUnsplit.count})`,
    `קבלת הלוואה ${result.loanDrawdown.total.toFixed(2)} (${result.loanDrawdown.count})`,
    `חיובי אשראי מפורטים ${result.cardSettled.total.toFixed(2)} (${result.cardSettled.count})`,
    `חיובי אשראי ללא פירוט ${result.cardUnitemized.total.toFixed(2)} (${result.cardUnitemized.count})`,
    `העברות פנימיות ${result.internalTransfer.total.toFixed(2)} (${result.internalTransfer.count})`,
  ];
  const tail =
    result.unresolved.count > 0
      ? ` · ⚠ ללא סיווג: ${result.unresolved.count} שורות (${result.unresolved.total.toFixed(2)})`
      : " · אין שורות ללא סיווג";
  return `${result.changed} שורות עודכנו · ${parts.join(" · ")}${tail}`;
}

export { EXPENSE_RESOLUTIONS, DEBT_RESOLUTIONS };
