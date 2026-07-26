import { prisma } from "../../config/database";
import { ApiError } from "../../utils/ApiError";
import { decimalToNumber, round2 } from "../../utils/money.utils";
import { classifyBankLine } from "./bankParser.service";

/**
 * Bank reconciliation.
 *
 * An imported bank statement lands as raw rows in `bank_transactions`. Those rows
 * are NOT copied blindly into incomes/loans/expenses — that would double-count
 * against the credit module and violate the single-source-of-truth rule
 * (CLAUDE.md §4). Instead this service *surfaces* each row with a suggestion and
 * lets the user promote it to the right tab. Promotion creates a real record in
 * the target table and links it back (`linked_*_id`), so the dashboard and every
 * tab pick it up through their existing queries — no read-path had to change.
 *
 * Double-count safety: credit-card settlement lines ("כרטיסי אשראי", direct
 * debits to card issuers) are classified `credit_card_payment` and auto-excluded,
 * because those exact charges are already itemized in the credit statement.
 */

// ---------------------------------------------------------------------------
// Income-type guessing — a *suggestion* only; the user confirms in the UI.
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Row shape returned to the client (Decimal already converted to number).
// ---------------------------------------------------------------------------
export interface ReconcileRow {
  id: number;
  date: string;
  description: string;
  amount: number;
  type: string;
  lineKind: string;
  loanRef: string | null;
  reconcileStatus: string;
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
    pendingIncome: number;
    pendingLoan: number;
    pendingSpend: number;
  };
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
  linkedIncomeId: number | null;
  linkedLoanId: number | null;
  linkedExpenseId: number | null;
};

function toRow(t: RawTx): ReconcileRow {
  const description = t.description ?? "";
  const row: ReconcileRow = {
    id: t.id,
    date: t.transactionDate.toISOString().slice(0, 10),
    description,
    amount: decimalToNumber(t.amount as never),
    type: t.type,
    lineKind: t.lineKind,
    loanRef: t.loanRef,
    reconcileStatus: t.reconcileStatus,
    linkedIncomeId: t.linkedIncomeId,
    linkedLoanId: t.linkedLoanId,
    linkedExpenseId: t.linkedExpenseId,
  };
  if (t.type === "deposit" && t.lineKind !== "interest_credit") {
    const guess = guessIncomeType(description);
    row.suggestedIncomeType = guess;
    row.suggestedIncomeLabel = INCOME_TYPE_LABELS[guess] ?? guess;
  }
  return row;
}

const LOAN_KINDS = new Set(["loan_principal", "loan_interest", "loan_mixed"]);

// ---------------------------------------------------------------------------
// Auto-reconciliation
// ---------------------------------------------------------------------------

/** Category that carries the cost of credit, so interest never hides in spend. */
const FINANCING_CATEGORY = "ריבית ועמלות בנק";

/** Interest rows are financing expense (CLAUDE.md §5) — real money, own bucket. */
const FINANCING_KINDS = new Set(["loan_interest", "overdraft_interest"]);

/** Same rule the parser uses to pair a debit with its returning credit. */
const ROUND_TRIP_MAX_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A credit this many times the typical one is not promoted to income on its own
 * say-so. Same ratio the parser uses to flag an atypical salary candidate: a
 * loan drawdown or a transfer between own accounts arrives as an ordinary credit
 * and is indistinguishable from income by wording alone — only its size gives it
 * away. Calling one "income" would overstate earnings and every figure derived
 * from them, so it is held for the user to name.
 */
const ATYPICAL_DEPOSIT_RATIO = 10;

/**
 * Ids of pending credits whose amount dwarfs the other credits. `candidates`
 * must already exclude round-trip legs, so an internal transfer cannot set the
 * baseline. With fewer than three credits there is no meaningful "typical" yet,
 * so nothing is flagged.
 */
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

/** What a single auto-reconcile pass did, in money terms — shown to the user. */
export interface AutoReconcileResult {
  incomeCount: number;
  incomeTotal: number;
  spendCount: number;
  spendTotal: number;
  financingCount: number;
  financingTotal: number;
  /** Held back for review, with the reason — never silently counted. */
  heldPrincipalCount: number;
  heldPrincipalTotal: number;
  heldMixedCount: number;
  heldMixedTotal: number;
  heldRoundTripCount: number;
  heldRoundTripTotal: number;
  heldInterestCreditCount: number;
  heldInterestCreditTotal: number;
  heldAtypicalCount: number;
  heldAtypicalTotal: number;
}

const emptyAutoResult = (): AutoReconcileResult => ({
  incomeCount: 0,
  incomeTotal: 0,
  spendCount: 0,
  spendTotal: 0,
  financingCount: 0,
  financingTotal: 0,
  heldPrincipalCount: 0,
  heldPrincipalTotal: 0,
  heldMixedCount: 0,
  heldMixedTotal: 0,
  heldRoundTripCount: 0,
  heldRoundTripTotal: 0,
  heldInterestCreditCount: 0,
  heldInterestCreditTotal: 0,
  heldAtypicalCount: 0,
  heldAtypicalTotal: 0,
});

/**
 * Ids of pending standard rows that look like one internal move (money left and
 * came back for the same amount within a few days). Both legs are returned so
 * neither is promoted: counting the incoming leg would invent income, counting
 * the outgoing leg would invent spending. Rows the user already excluded still
 * take part in the matching — that is how a half-excluded pair is caught.
 */
function findRoundTripIds(rows: Array<{ id: number; transactionDate: Date; amount: number; type: string; lineKind: string; reconcileStatus: string }>): Set<number> {
  const held = new Set<number>();
  const takenDeposits = new Set<number>();
  const standard = rows.filter((r) => r.lineKind === "standard" && r.reconcileStatus !== "done");
  for (const withdrawal of standard) {
    if (withdrawal.type !== "withdrawal") continue;
    let match: (typeof standard)[number] | null = null;
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

async function requireTx(userId: number, id: number) {
  const tx = await prisma.bankTransaction.findFirst({ where: { id, userId } });
  if (!tx) throw ApiError.notFound("התנועה הבנקאית לא נמצאה");
  return tx;
}

export const reconciliationService = {
  /**
   * Recompute lineKind/loanRef from the description for every row that the user
   * has not touched yet (status = pending). Idempotent — safe to run repeatedly.
   * This back-fills rows imported before classification was persisted, and marks
   * credit-card settlements as excluded so they never reach the spend figures.
   */
  async backfillClassification(userId: number): Promise<number> {
    const rows = await prisma.bankTransaction.findMany({
      where: { userId, reconcileStatus: "pending" },
      select: { id: true, description: true, type: true, lineKind: true, loanRef: true },
    });
    let updated = 0;
    for (const r of rows) {
      const type = r.type === "deposit" ? "deposit" : "withdrawal";
      const { lineKind, loanRef } = classifyBankLine(r.description, type);
      const nextStatus = lineKind === "credit_card_payment" ? "excluded" : "pending";
      if (lineKind !== r.lineKind || (loanRef ?? null) !== (r.loanRef ?? null)) {
        await prisma.bankTransaction.update({
          where: { id: r.id },
          data: { lineKind, loanRef, reconcileStatus: nextStatus },
        });
        updated += 1;
      }
    }
    return updated;
  },

  /**
   * Promote every pending row the statement classifies unambiguously, so an
   * imported file reaches the dashboard figures without 50 manual clicks.
   *
   * What is promoted: ordinary credits become Income, ordinary debits become
   * Expense, and interest (loan or overdraft) becomes a financing Expense in its
   * own category — interest is a real cost of credit (CLAUDE.md §5).
   *
   * What is deliberately held for review, because promoting it would state
   * something the statement never said:
   *   - loan principal: debt reduction, not spending. Belongs to a Loan, and a
   *     loan needs terms only the user can supply.
   *   - loan_mixed: a combined repayment with no principal/interest split.
   *   - round-trip legs: money that left and came back — an internal transfer.
   *   - interest credits: a rebate, never income.
   *
   * Idempotent: only `pending` rows are touched, and each promoted row is marked
   * done + linked, so re-running promotes nothing twice. `reset` undoes a row.
   */
  async autoReconcile(userId: number): Promise<AutoReconcileResult> {
    await this.backfillClassification(userId);
    const rows = await prisma.bankTransaction.findMany({
      where: { userId },
      orderBy: [{ transactionDate: "asc" }, { id: "asc" }],
      select: {
        id: true,
        transactionDate: true,
        description: true,
        amount: true,
        type: true,
        lineKind: true,
        categoryId: true,
        reconcileStatus: true,
      },
    });
    const shaped = rows.map((r) => ({ ...r, amount: decimalToNumber(r.amount) }));
    const roundTripIds = findRoundTripIds(shaped);
    // Baseline for "typical" is drawn from real credits only: round-trip legs
    // are internal moves, so letting one set the median would mask an outlier.
    const atypicalIds = findAtypicalDepositIds(
      shaped.filter(
        (r) => r.type === "deposit" && r.lineKind === "standard" && !roundTripIds.has(r.id)
      )
    );

    const financingCategory = await prisma.category.findFirst({
      where: { name: FINANCING_CATEGORY, OR: [{ userId }, { userId: null }] },
      select: { id: true },
    });

    const result = emptyAutoResult();
    for (const row of shaped) {
      if (row.reconcileStatus !== "pending") continue;

      if (roundTripIds.has(row.id)) {
        result.heldRoundTripCount += 1;
        result.heldRoundTripTotal = round2(result.heldRoundTripTotal + row.amount);
        continue;
      }
      if (row.lineKind === "loan_principal") {
        result.heldPrincipalCount += 1;
        result.heldPrincipalTotal = round2(result.heldPrincipalTotal + row.amount);
        continue;
      }
      if (row.lineKind === "loan_mixed") {
        result.heldMixedCount += 1;
        result.heldMixedTotal = round2(result.heldMixedTotal + row.amount);
        continue;
      }
      if (row.lineKind === "interest_credit") {
        result.heldInterestCreditCount += 1;
        result.heldInterestCreditTotal = round2(result.heldInterestCreditTotal + row.amount);
        continue;
      }
      if (atypicalIds.has(row.id)) {
        result.heldAtypicalCount += 1;
        result.heldAtypicalTotal = round2(result.heldAtypicalTotal + row.amount);
        continue;
      }

      if (row.type === "deposit" && row.lineKind === "standard") {
        const income = await prisma.income.create({
          data: {
            userId,
            amount: row.amount,
            type: guessIncomeType(row.description ?? ""),
            description: row.description ?? null,
            incomeDate: row.transactionDate,
          },
        });
        await prisma.bankTransaction.update({
          where: { id: row.id },
          data: { reconcileStatus: "done", linkedIncomeId: income.id },
        });
        result.incomeCount += 1;
        result.incomeTotal = round2(result.incomeTotal + row.amount);
        continue;
      }

      if (row.type === "withdrawal" && (row.lineKind === "standard" || FINANCING_KINDS.has(row.lineKind))) {
        const isFinancing = FINANCING_KINDS.has(row.lineKind);
        const expense = await prisma.expense.create({
          data: {
            userId,
            amount: row.amount,
            categoryId: isFinancing ? (financingCategory?.id ?? null) : row.categoryId,
            businessName: row.description ?? null,
            description: row.description ?? null,
            expenseDate: row.transactionDate,
            source: "bank_import",
          },
        });
        await prisma.bankTransaction.update({
          where: { id: row.id },
          data: { reconcileStatus: "done", linkedExpenseId: expense.id },
        });
        if (isFinancing) {
          result.financingCount += 1;
          result.financingTotal = round2(result.financingTotal + row.amount);
        } else {
          result.spendCount += 1;
          result.spendTotal = round2(result.spendTotal + row.amount);
        }
      }
    }
    return result;
  },

  async getReconciliation(userId: number): Promise<ReconciliationView> {
    await this.backfillClassification(userId);
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
        linkedIncomeId: true,
        linkedLoanId: true,
        linkedExpenseId: true,
      },
    })) as RawTx[];

    const rows = txs.map(toRow);
    const pending = rows.filter((r) => r.reconcileStatus === "pending");

    const incomeCandidates = pending.filter((r) => r.type === "deposit" && r.lineKind !== "interest_credit");
    const loanRows = pending.filter((r) => LOAN_KINDS.has(r.lineKind));
    const standardSpend = pending.filter(
      (r) => r.type === "withdrawal" && r.lineKind === "standard"
    );
    const financingLines = rows.filter(
      (r) =>
        (r.lineKind === "overdraft_interest" || r.lineKind === "interest_credit") &&
        r.reconcileStatus === "pending"
    );
    const creditCardPayments = rows.filter((r) => r.lineKind === "credit_card_payment");
    const done = rows.filter((r) => r.reconcileStatus === "done");

    // Group loan-payment rows by loan reference. Principal lines often carry no
    // number in the statement, so they collect under a "no number" group the
    // user assigns manually.
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
        pendingIncome: incomeCandidates.length,
        pendingLoan: loanRows.length,
        pendingSpend: standardSpend.length,
      },
      incomeCandidates,
      loanGroups,
      standardSpend,
      financingLines,
      creditCardPayments,
      done,
    };
  },

  /** Promote a deposit into a real Income record, linked back to the bank row. */
  async linkIncome(userId: number, transactionId: number, body: { type: string; description?: string | null }) {
    const tx = await requireTx(userId, transactionId);
    if (tx.type !== "deposit") throw ApiError.badRequest("רק הפקדה יכולה להפוך להכנסה");
    if (tx.reconcileStatus === "done") throw ApiError.conflict("התנועה כבר שויכה");
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
      data: { reconcileStatus: "done", linkedIncomeId: income.id },
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
    if (tx.reconcileStatus === "done") throw ApiError.conflict("התנועה כבר שויכה");
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
      data: { reconcileStatus: "done", linkedExpenseId: expense.id },
    });
    return expense;
  },

  /**
   * Create a Loan from a detected group (or link its rows to an existing loan),
   * and mark every supplied bank row done + linked. The stateful loan fields
   * (original amount, rate, term) come from the user — a statement line cannot
   * supply them — with monthlyPayment pre-filled by the caller from the group.
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
      const created = await prisma.loan.create({
        data: {
          userId,
          loanName: body.loanName ?? "הלוואה מיובאת",
          loanType: body.loanType ?? "bank",
          lenderName: body.lenderName ?? null,
          originalAmount: body.originalAmount ?? 0,
          currentBalance: body.currentBalance ?? body.originalAmount ?? 0,
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

  /** Set aside a row as not-a-new-record (e.g. an internal transfer). */
  async exclude(userId: number, transactionId: number) {
    await requireTx(userId, transactionId);
    return prisma.bankTransaction.update({
      where: { id: transactionId },
      data: { reconcileStatus: "excluded", linkedIncomeId: null, linkedLoanId: null, linkedExpenseId: null },
    });
  },

  /**
   * Undo a reconciliation: delete the record it created (so nothing is left
   * double-counted) and return the row to pending.
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
          linkedIncomeId: null,
          linkedLoanId: null,
          linkedExpenseId: null,
        },
      });
    });
  },
};
