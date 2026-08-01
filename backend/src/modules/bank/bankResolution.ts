/**
 * What a reconciled bank row means financially (CLAUDE.md §5). A row can be
 * resolved and still be absent from every expense figure — principal lowers debt,
 * a settled card bill is itemized in the credit module — and the resolution names
 * where it went instead.
 */
export type BankResolution =
  | "income"
  | "expense"
  /** Interest paid — financing expense, own category. */
  | "financing_charge"
  /** Interest refunded — a NEGATIVE financing expense, never income. */
  | "financing_credit"
  /** Loan principal — lowers debt, not spending. */
  | "debt_reduction"
  /** Combined loan payment the statement never split. */
  | "loan_repayment_unsplit"
  /** A loan received — a liability, never income. */
  | "loan_drawdown"
  /** Itemized in the credit module — excluded, no double count. */
  | "credit_card_settled"
  /** No matching credit import — real spend, counted here. */
  | "credit_card_unitemized"
  | "internal_transfer"
  /** Set aside by hand; the resolver never touches it again. */
  | "manual_excluded";

/** Resolutions whose amount lands in an expense figure. */
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

/** One wording per resolution, used by API and UI alike. */
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
