/**
 * What a reconciled bank row MEANS financially. One row → exactly one resolution,
 * so "where did this money go in the app?" always has an answer, and the reverse
 * question — "which rows make up this figure?" — can be answered from the data.
 *
 * The split between `reconcileStatus` and `resolution` is deliberate:
 *   - `reconcileStatus` says whether a human still has to look at the row.
 *   - `resolution` says what the row is, in money terms.
 * A row may be `done` and still be absent from every expense figure (principal is
 * debt reduction, a settled card bill is already itemized in the credit module) —
 * that is not money falling between the chairs, it is money counted elsewhere,
 * and each case names where.
 */
export type BankResolution =
  /** Promoted to הכנסות. */
  | "income"
  /** Promoted to הוצאות — ordinary spending. */
  | "expense"
  /** Interest paid: an expense, in the financing category (CLAUDE.md §5). */
  | "financing_charge"
  /** Interest refunded: a NEGATIVE financing expense. Never income. */
  | "financing_credit"
  /** Loan principal: lowers debt. Not spending, shown in הלוואות. */
  | "debt_reduction"
  /** Combined loan payment the statement never split into principal/interest. */
  | "loan_repayment_unsplit"
  /** A loan received: creates a liability, never income. */
  | "loan_drawdown"
  /** Card bill already itemized in the credit module — excluded, no double count. */
  | "credit_card_settled"
  /** Card bill with no matching credit import: real spend, counted here. */
  | "credit_card_unitemized"
  /** Money moved between the user's own accounts — both legs held out. */
  | "internal_transfer"
  /** The user set this row aside by hand. The resolver never touches it again. */
  | "manual_excluded";

/** Resolutions that put the row's amount into an expense figure. */
export const EXPENSE_RESOLUTIONS: ReadonlySet<BankResolution> = new Set<BankResolution>([
  "expense",
  "financing_charge",
  "financing_credit",
  "credit_card_unitemized",
]);

/** Resolutions that lower debt instead of being spending. */
export const DEBT_RESOLUTIONS: ReadonlySet<BankResolution> = new Set<BankResolution>([
  "debt_reduction",
  "loan_repayment_unsplit",
]);

/** Human-readable label per resolution — one wording, used by API and UI alike. */
export const RESOLUTION_LABELS: Record<BankResolution, string> = {
  income: "הכנסה",
  expense: "הוצאה שוטפת",
  financing_charge: "ריבית — הוצאה מימונית",
  financing_credit: "זיכוי ריבית — הוצאה מימונית שלילית",
  debt_reduction: "תשלום קרן — הקטנת חוב",
  loan_repayment_unsplit: "תשלום הלוואה ללא פירוט קרן/ריבית",
  loan_drawdown: "קבלת הלוואה — התחייבות",
  credit_card_settled: "חיוב כרטיס אשראי — מפורט בטאב אשראי",
  credit_card_unitemized: "חיוב כרטיס אשראי ללא פירוט — נספר כהוצאה",
  internal_transfer: "העברה פנימית בין חשבונות",
  manual_excluded: "הוחרג ידנית",
};
