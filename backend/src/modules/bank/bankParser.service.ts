import pdfParse from "pdf-parse/lib/pdf-parse.js";
import * as XLSX from "xlsx";
import { ApiError } from "../../utils/ApiError";
import { round2 } from "../../utils/money.utils";

export type BankTransactionKind = "deposit" | "withdrawal";

/**
 * Secondary classification of a statement line. The money direction is ALWAYS
 * taken from the physical column (זכות = in / חובה = out); lineKind only says
 * *what kind* of money it is, so financing rows (interest) can be told apart
 * from ordinary spending and from debt repayment (principal).
 *
 * In this statement format the bank already prints principal and interest on
 * separate lines, so our job is classification — not arithmetic splitting.
 * `loan_mixed` marks a combined repayment line that carries no breakdown.
 */
export type BankLineKind =
  | "standard"
  | "loan_principal"
  | "loan_interest"
  | "overdraft_interest"
  | "loan_mixed";

/** How well a row's running balance could be verified. */
export type BankBalanceCheck = "printed" | "chain" | "unverified" | "mismatch";

export interface ParsedBankRow {
  date: Date;
  description: string;
  amount: number; // always positive
  type: BankTransactionKind;
  /** Secondary (text-based) classification — never decides deposit/withdrawal. */
  lineKind: BankLineKind;
  /** Loan/facility number carried by the description (00965, 01015, 108…). */
  loanRef: string | null;
  /**
   * An interest credit belongs to the ACCOUNT, not to a single loan: the number
   * printed on such a line is the account reference, not a loan number. Netting
   * interest is therefore allowed at account+month level only — never per loan.
   */
  accountLevelCredit: boolean;
  /** Debit/credit pair of the same amount a few days apart — money that may
   *  have only left and come back. Held out of income until a human confirms. */
  possibleRoundTrip: boolean;
  /** Credit that looks like a salary/employer payment. Never auto-confirmed. */
  salaryCandidate: boolean;
  /** Set by the user, not by the parser — a candidate stays unconfirmed here. */
  salaryConfirmed: boolean;
  /** Salary candidate far out of line with the other ones — needs approval. */
  atypicalAmount: boolean;
  /** Factual note for the review UI. Never a hypothesis about bank policy. */
  note: string | null;
  /** Running balance printed on the row, when the file shows one. */
  balance: number | null;
  /** 0..1 — how sure we are of this row (column distance × balance check). */
  confidence: number;
  balanceCheck: BankBalanceCheck;
  raw: Record<string, unknown>;
}

/** Fields every parser path fills; the analysis flags are added afterwards. */
type ParsedBankRowCore = Omit<
  ParsedBankRow,
  "accountLevelCredit" | "possibleRoundTrip" | "salaryCandidate" | "salaryConfirmed" | "atypicalAmount" | "note"
>;

/** Build a row with neutral analysis flags — set later, in one place. */
function toRow(core: ParsedBankRowCore): ParsedBankRow {
  return {
    ...core,
    accountLevelCredit: false,
    possibleRoundTrip: false,
    salaryCandidate: false,
    salaryConfirmed: false,
    atypicalAmount: false,
    note: null,
  };
}

/** A row we could not turn into a transaction, or one that needs a human look. */
export interface BankRowIssue {
  page: number | null;
  line: string;
  reason: string;
}

export interface BankBalanceMismatch {
  index: number;
  date: string;
  description: string;
  expected: number;
  printed: number;
  diff: number;
}

/**
 * The money in a statement, split into buckets that must never be merged.
 *
 * Financing is reported three ways on purpose: gross charged, credited back,
 * and the derived net — so a netted figure can never be mistaken for the real
 * cost of credit. Loan principal (debt reduction) and a combined repayment line
 * with no breakdown (`loan_mixed`) each get their own bucket too: adding them
 * together would report money as "principal" that the statement never called
 * principal.
 */
export interface BankMoneySummary {
  /** Raw column sums. For auditing the balance replay only — not for reporting. */
  depositsRaw: number;
  withdrawalsRaw: number;
  /** Income = credit column minus interest credits (financing, not income). */
  income: number;
  /** Income once pending round-trips are set aside, awaiting manual approval. */
  incomeConfirmed: number;
  /** Ordinary spending: debit rows whose lineKind is "standard" — nothing else. */
  currentSpend: number;
  /** …after setting aside the outgoing leg of a pending round-trip. */
  currentSpendConfirmed: number;
  /** Interest charged, gross. This is the cost of credit. */
  financingCharged: number;
  /** Interest credited back by the bank (account level). */
  financingRefunded: number;
  /** Derived: charged − refunded. Always presented as "מקוזז". */
  financingNet: number;
  /** Loan principal repaid — debt reduction, not spending. */
  principal: number;
  /** Combined loan payments with no principal/interest split in the statement. */
  mixed: number;
  /** Money that left and came back within days, pending manual approval. */
  roundTripPending: number;
}

/** Per-loan financing. Gross only — interest is never netted at loan level. */
export interface BankLoanFinancing {
  loanRef: string;
  interestChargedGross: number;
  lines: number;
}

/** Account-level interest netting, per calendar month. The only legal netting. */
export interface BankMonthFinancing {
  month: string; // YYYY-MM
  charged: number;
  refunded: number;
  net: number;
}

/** A debit/credit pair of the same amount, days apart — possibly the same money. */
export interface BankRoundTrip {
  amount: number;
  withdrawalDate: string;
  withdrawalDescription: string;
  depositDate: string;
  depositDescription: string;
  daysApart: number;
}

export type BankConditionState = "met" | "not_met" | "unknown";

/**
 * Monthly salary-deposit condition. A calendar month that the file does not
 * cover end-to-end is "unknown" — including the last one: a cumulative monthly
 * rule cannot be decided before the month is over. We never answer "not_met"
 * on a partial month, and the state is derived from salary deposits alone.
 */
export interface BankMonthlyCondition {
  month: string; // YYYY-MM
  fullyCovered: boolean;
  state: BankConditionState;
  salaryTotal: number;
  threshold: number;
  /** The deciding deposit is a candidate the user has not confirmed yet. */
  awaitingConfirmation: boolean;
  reason: string;
}

/** Everything the import flow needs to explain what happened, in Hebrew. */
export interface BankIngestionReport {
  parser: "excel" | "pdf-columns" | "pdf-text";
  parserLabel: string;
  rowsDetected: number;
  rowsRejected: number;
  rejected: BankRowIssue[];
  /** Rows below the confidence threshold — surfaced, never silently dropped. */
  review: BankRowIssue[];
  balanceMismatches: BankBalanceMismatch[];
  openingBalance: number | null;
  closingBalance: number | null;
  /** File coverage (first/last transaction date) — drives month completeness. */
  coverageFrom: string | null;
  coverageTo: string | null;
  money: BankMoneySummary;
  loanFinancing: BankLoanFinancing[];
  monthFinancing: BankMonthFinancing[];
  roundTrips: BankRoundTrip[];
  salaryCandidates: BankRowIssue[];
  monthlyConditions: BankMonthlyCondition[];
  byLineKind: Record<BankLineKind, number>;
}

/** Hebrew labels — one wording for every screen, so buckets can't blur. */
export const BANK_MONEY_LABELS = {
  income: "הכנסות",
  incomeConfirmed: "הכנסות (בניכוי סבב כספים בהמתנה לאישור)",
  currentSpend: "הוצאה שוטפת",
  financingCharged: "הוצאה מימונית — חיוב ריבית (ברוטו)",
  financingRefunded: "זיכוי ריבית",
  financingNet: "הוצאה מימונית — מקוזז",
  principal: "החזר קרן — הקטנת חוב",
  mixed: "תשלום הלוואה — ללא פירוט קרן/ריבית",
} as const;

export interface ParsedBankStatement {
  rows: ParsedBankRow[];
  report: BankIngestionReport;
}

type Cell = string | number | Date | boolean | null | undefined;
type Role = "date" | "description" | "debit" | "credit" | "amount" | "balance";

/**
 * Header keywords → column role for an Israeli current-account (עו״ש) statement.
 * Matched case-insensitively, substring. Bank exports vary: some split money-out
 * (חובה) and money-in (זכות) into two columns; others use one signed סכום column.
 * We detect whichever layout is present. "balance" (יתרה) is detected both so its
 * column isn't mistaken for the amount and to verify the running balance.
 */
const HEADER_MATCHERS: Array<{ role: Role; keywords: string[] }> = [
  { role: "date", keywords: ["תאריך", "ת. ערך", "תאריך ערך"] },
  { role: "description", keywords: ["תיאור", "פירוט", "תנועה", "פעולה", "סוג פעולה", "שם"] },
  { role: "debit", keywords: ["חובה", "בחובה", "משיכה", "חיוב"] },
  { role: "credit", keywords: ["זכות", "בזכות", "הפקדה", "זיכוי"] },
  { role: "balance", keywords: ["יתרה"] },
  { role: "amount", keywords: ["סכום"] },
];

function findHeaderRow(rows: Cell[][]): { rowIndex: number; columns: Partial<Record<Role, number>> } | null {
  for (let rowIndex = 0; rowIndex < Math.min(rows.length, 30); rowIndex += 1) {
    const row = rows[rowIndex] ?? [];
    const columns: Partial<Record<Role, number>> = {};
    for (let colIndex = 0; colIndex < row.length; colIndex += 1) {
      const cell = String(row[colIndex] ?? "").trim();
      if (!cell) continue;
      for (const matcher of HEADER_MATCHERS) {
        if (columns[matcher.role] !== undefined) continue;
        if (matcher.keywords.some((keyword) => cell.includes(keyword))) {
          columns[matcher.role] = colIndex;
        }
      }
    }
    // A statement is recognizable once it has a date column plus a way to read
    // the money moved: either split debit/credit, or a single amount column.
    const hasMoney = columns.debit !== undefined || columns.credit !== undefined || columns.amount !== undefined;
    if (columns.date !== undefined && hasMoney) {
      return { rowIndex, columns };
    }
  }
  return null;
}

function parseCellDate(value: Cell): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return null;
    return new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d));
  }
  if (typeof value === "string") {
    const text = value.trim();
    const iso = /^(\d{4})[./-](\d{1,2})[./-](\d{1,2})/.exec(text);
    if (iso) return new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
    const dmy = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/.exec(text);
    if (dmy) {
      let year = Number(dmy[3]);
      if (year < 100) year += 2000;
      return new Date(Date.UTC(year, Number(dmy[2]) - 1, Number(dmy[1])));
    }
    return null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Money text normalization — one implementation for every parser path
// ---------------------------------------------------------------------------

/** Plain decimal, after normalization strips currency/spaces/separators. */
const PLAIN_NUMBER = /^-?\d+(?:\.\d+)?$/;

/**
 * Strip everything a bank may decorate a number with: shekel/other currency
 * signs, thousands separators, regular + non-breaking/thin spaces, and the
 * Unicode minus / dashes that PDFs emit instead of ASCII "-".
 */
function normalizeMoneyText(raw: string): string {
  return raw
    .replace(/[\u20AA$\u20AC\u00A3]/g, "") // shekel, dollar, euro, pound
    .replace(/[\u2212\u2012\u2013\u2014\u2015]/g, "-") // minus sign / dashes
    .replace(/[\s\u200B\u200E\u200F\uFEFF]/g, "") // incl. nbsp, thin space, RTL marks
    .replace(/,/g, "");
}

/**
 * Parse a money token, keeping the sign. Accepts "1,234.56", "₪ 1 234.56",
 * "−50.00", "(50.00)" and the trailing-minus form "50.00-" used by some
 * Israeli exports. Returns null for anything that isn't a number.
 */
function parseMoneyText(raw: string): number | null {
  let cleaned = normalizeMoneyText(raw);
  if (!cleaned) return null;
  const parens = /^\((.+)\)$/.exec(cleaned);
  if (parens) cleaned = `-${parens[1]}`;
  if (/^\d+(?:\.\d+)?-$/.test(cleaned)) cleaned = `-${cleaned.slice(0, -1)}`;
  if (!PLAIN_NUMBER.test(cleaned)) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? round2(parsed) : null;
}

/** Parse a spreadsheet money cell, keeping the sign. */
function parseSignedAmount(value: Cell): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? round2(value) : null;
  if (typeof value === "string") return parseMoneyText(value);
  return null;
}

// ---------------------------------------------------------------------------
// Secondary classification: loan principal / interest / overdraft interest
// ---------------------------------------------------------------------------

/**
 * Loan-related line patterns, most specific first. The bank prints principal and
 * interest as separate lines, so this is a *labelling* step: it never changes
 * the deposit/withdrawal decision, which comes from the physical column only.
 *
 *   הלוואה - תשלום קרן            → principal (debt reduction, not spending)
 *   הלוואה - תשלום ריבית 00965    → interest  (financing expense)
 *   ריבית על הלוואה 00990 28/05   → interest  (financing expense)
 *   ריבית על מסגרת ראשית 13.00%   → overdraft interest (financing expense)
 *   זיכוי בגין הטבה זמנית בריבית משיכת יתר
 *                                 → overdraft interest, credit direction: a
 *                                   rebate on facility interest, i.e. negative
 *                                   financing expense — never income.
 *   הלואה-תשלום 108               → combined repayment, no breakdown available
 */
const LINE_KIND_PATTERNS: Array<{ kind: BankLineKind; pattern: RegExp }> = [
  { kind: "loan_principal", pattern: /הלוו?אה\s*-?\s*תשלום\s*קרן/ },
  { kind: "loan_interest", pattern: /הלוו?אה\s*-?\s*תשלום\s*ריבית/ },
  { kind: "loan_interest", pattern: /ריבית\s*על\s*הלוו?אה/ },
  // Rebates/refunds on facility (overdraft) interest, in either word order.
  // Must be matched before the row can fall through to "standard".
  { kind: "overdraft_interest", pattern: /(זיכוי|החזר|הטבה).{0,30}ריבית.{0,20}(משיכת\s*יתר|מסגרת)/ },
  { kind: "overdraft_interest", pattern: /ריבית.{0,20}(משיכת\s*יתר|מסגרת).{0,30}(זיכוי|החזר|הטבה)/ },
  { kind: "overdraft_interest", pattern: /ריבית\s*על\s*מסגרת/ },
  { kind: "loan_mixed", pattern: /הלוו?אה\s*-?\s*תשלום\s*\d{2,6}(?:\s|$)/ },
];

/** Loan/facility number inside the description — after removing date fragments. */
function extractLoanRef(description: string): string | null {
  const withoutDates = description.replace(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g, " ");
  const match = /(?:^|\s)(\d{3,6})(?=\s|$)/.exec(withoutDates);
  return match ? match[1] : null;
}

/** Only loan lines carry a loan number; a facility (מסגרת) belongs to the account. */
const KINDS_WITH_LOAN_REF: ReadonlySet<BankLineKind> = new Set<BankLineKind>(["loan_interest", "loan_mixed"]);

function classifyLineKind(description: string): { lineKind: BankLineKind; loanRef: string | null } {
  const text = description.replace(/\s+/g, " ").trim();
  for (const { kind, pattern } of LINE_KIND_PATTERNS) {
    if (pattern.test(text)) {
      return { lineKind: kind, loanRef: KINDS_WITH_LOAN_REF.has(kind) ? extractLoanRef(text) : null };
    }
  }
  return { lineKind: "standard", loanRef: null };
}

// ---------------------------------------------------------------------------
// Post-processing: account-level credits, round-trips, salary candidates
//
// Everything here runs AFTER the direction of each row is already fixed by its
// physical column. Nothing in this block may change `type` — lineKind, text and
// flags describe *what* the money is, never *which way* it moved.
// ---------------------------------------------------------------------------

const INTEREST_KINDS: ReadonlySet<BankLineKind> = new Set<BankLineKind>([
  "loan_interest",
  "overdraft_interest",
]);

function isInterestRow(row: ParsedBankRow): boolean {
  return INTEREST_KINDS.has(row.lineKind);
}

/**
 * Reconciliation-level classification, derived from the description + physical
 * direction. Extends the parser's lineKind with two buckets the reconciliation
 * flow needs, keeping every Israeli-bank text pattern in this one file:
 *   - credit_card_payment: a credit-card bill settled FROM the account. Already
 *     itemized in the credit module, so it MUST be excluded from spend to avoid
 *     double-counting (CLAUDE.md §4).
 *   - interest_credit: an interest line printed in the credit column — an
 *     account-level interest rebate, never income.
 */
export type ReconcileLineKind =
  | BankLineKind
  | "credit_card_payment"
  | "interest_credit"
  | "loan_drawdown";

// Credit-card bill settlements drawn from the current account: the generic
// "כרטיסי אשראי" wording, direct-debit ("עפ״י הרשאה") and the card issuers.
// NB: no `\b` anywhere in this file's Hebrew patterns. In JavaScript a word
// boundary is defined against [A-Za-z0-9_], so a Hebrew letter is a NON-word
// character and `\bכאל\b` can never match "הרשאה כאל" — the space and the א are
// both non-word, so there is no boundary between them. Card issuers are therefore
// anchored on the surrounding characters by hand.
//
// Both edges are required, and both matter: without the leading one "כאל" matches
// inside "מיכאל" and a supplier payment would be excluded from spend as a card
// settlement; without the trailing one "מקס" matches inside "מקסימום".
const ISSUER_EDGE = "(?:^|[\\s\\-–־\"״'`(\\[])";
const ISSUER_NAMES = "כאל|ויזה|ישראכרט|מאסטרקארד|לאומי\\s*קארד|מקס|אמריקן\\s*אקספרס|דיינרס";
const ISSUER_TAIL = "(?=$|[\\s\\-–־\"״'`)\\],.:]|\\d)";

const CREDIT_CARD_PAYMENT_PATTERN = new RegExp(
  `כרטיס(?:י)?\\s*אשראי|עפ["״'\`]?י\\s*הרשאה|הרשאה\\s*לחיוב|${ISSUER_EDGE}(?:${ISSUER_NAMES})${ISSUER_TAIL}`
);

/**
 * Money RECEIVED from a loan. It arrives in the credit column like any other
 * deposit, so only the wording tells it apart — and getting it wrong is
 * expensive: a drawdown is a new liability, never income (CLAUDE.md §5). Interest
 * lines are already handled above, so anything else naming a loan on the way IN
 * is the loan itself landing in the account.
 */
const LOAN_DRAWDOWN_PATTERN = /הלוו?אה/;

export function classifyBankLine(
  description: string | null,
  type: BankTransactionKind
): { lineKind: ReconcileLineKind; loanRef: string | null } {
  const text = (description ?? "").replace(/\s+/g, " ").trim();
  const base = classifyLineKind(text);
  // Interest in the credit column is an account-level rebate, not income.
  if (INTEREST_KINDS.has(base.lineKind) && type === "deposit") {
    return { lineKind: "interest_credit", loanRef: null };
  }
  // A loan landing in the account: a liability, not income. Only an otherwise
  // ordinary credit qualifies — a principal/mixed line in the credit column is a
  // reversal of a repayment, which keeps its own kind and its own bucket.
  if (type === "deposit" && base.lineKind === "standard" && LOAN_DRAWDOWN_PATTERN.test(text)) {
    return { lineKind: "loan_drawdown", loanRef: extractLoanRef(text) };
  }
  // Credit-card settlements only matter on the way OUT (already in credit module).
  if (type === "withdrawal" && base.lineKind === "standard" && CREDIT_CARD_PAYMENT_PATTERN.test(text)) {
    return { lineKind: "credit_card_payment", loanRef: null };
  }
  return base;
}

/**
 * Which card a settlement line refers to. The last four digits are the reliable
 * key — they appear on both the bank line ("כרטיסי אשראי לי - 2349") and the
 * credit statement ("ויזה 2349"). The issuer name is only a fallback for lines
 * that name no card at all ("עפ״י הרשאה כאל").
 */
export interface CreditCardRef {
  last4: string | null;
  issuer: string | null;
}

const CARD_ISSUER_PATTERN = new RegExp(`${ISSUER_EDGE}(${ISSUER_NAMES})${ISSUER_TAIL}`);

export function creditCardRefOf(description: string | null): CreditCardRef {
  const text = (description ?? "").replace(/\s+/g, " ").trim();
  // Take the LAST 4-digit group: issuer codes and branch numbers come first.
  const digits = text.match(/\d{4}(?!\d)/g);
  const issuer = CARD_ISSUER_PATTERN.exec(text);
  return {
    last4: digits && digits.length > 0 ? digits[digits.length - 1]! : null,
    issuer: issuer ? issuer[1]!.replace(/\s+/g, " ") : null,
  };
}

/** Interest credited back. Stated as fact only — the statement gives no reason. */
const INTEREST_CREDIT_NOTE = "זיכוי ריבית — הוצאה מימונית שלילית, לא הכנסה";
const INTEREST_OFFSET_NOTE = "זיכוי ריבית שקוזז מול חיוב זהה באותו יום — סיבה לא ידועה מהדוח";

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function monthKey(date: Date): string {
  return date.toISOString().slice(0, 7);
}

/**
 * Interest credits are account-level. The number printed on such a line is the
 * account reference (REDACTED_ACCOUNT_NUMBER → "03757"), not a loan number, so keeping it as
 * `loanRef` would silently net interest against an unrelated loan. We clear it
 * and mark the row instead: netting is then only possible per account+month.
 */
function annotateAccountLevelCredits(rows: ParsedBankRow[]): void {
  const sameDayDebits = new Map<string, number>();
  for (const row of rows) {
    if (row.type !== "withdrawal" || !isInterestRow(row)) continue;
    const key = `${dayKey(row.date)}|${row.amount.toFixed(2)}`;
    sameDayDebits.set(key, (sameDayDebits.get(key) ?? 0) + 1);
  }
  for (const row of rows) {
    if (row.type !== "deposit" || !isInterestRow(row)) continue;
    row.accountLevelCredit = true;
    row.loanRef = null;
    const key = `${dayKey(row.date)}|${row.amount.toFixed(2)}`;
    row.note = (sameDayDebits.get(key) ?? 0) > 0 ? INTEREST_OFFSET_NOTE : INTEREST_CREDIT_NOTE;
  }
}

/** A debit and a credit of the same amount this close together may be one move. */
const ROUND_TRIP_MAX_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Flag money that left the account and came back (or the reverse) within a few
 * days for the same amount — a transfer to another account, a cancelled payment.
 * Counting the incoming leg as income would invent money, so both legs are held
 * out of the "confirmed" figures until the user says what it was. Only ordinary
 * rows are paired: financing credits are already handled as financing.
 */
function annotateRoundTrips(rows: ParsedBankRow[]): BankRoundTrip[] {
  const pairs: BankRoundTrip[] = [];
  const takenDeposits = new Set<number>();
  rows.forEach((withdrawal, wi) => {
    if (withdrawal.type !== "withdrawal" || withdrawal.lineKind !== "standard") return;
    let matchIndex = -1;
    let bestGap = Number.POSITIVE_INFINITY;
    rows.forEach((deposit, di) => {
      if (di === wi || takenDeposits.has(di)) return;
      if (deposit.type !== "deposit" || deposit.lineKind !== "standard") return;
      if (Math.abs(deposit.amount - withdrawal.amount) > 0.005) return;
      const gap = Math.abs(deposit.date.getTime() - withdrawal.date.getTime()) / DAY_MS;
      if (gap > ROUND_TRIP_MAX_DAYS || gap >= bestGap) return;
      bestGap = gap;
      matchIndex = di;
    });
    if (matchIndex === -1) return;
    const deposit = rows[matchIndex]!;
    takenDeposits.add(matchIndex);
    withdrawal.possibleRoundTrip = true;
    deposit.possibleRoundTrip = true;
    const note = `סבב כספים אפשרי: ${withdrawal.amount.toFixed(2)} יצא ב-${dayKey(
      withdrawal.date
    )} וחזר ב-${dayKey(deposit.date)} — מוחרג מההכנסה עד אישור ידני`;
    withdrawal.note = note;
    deposit.note = note;
    pairs.push({
      amount: withdrawal.amount,
      withdrawalDate: dayKey(withdrawal.date),
      withdrawalDescription: withdrawal.description,
      depositDate: dayKey(deposit.date),
      depositDescription: deposit.description,
      daysApart: Math.round(bestGap),
    });
  });
  return pairs;
}

/**
 * Salary candidates. A credit only qualifies when the statement names a payer:
 * generic bank wording (זיכוי / העברה) says nothing, and allowances are income
 * but not salary. A candidate is never confirmed here — the user confirms.
 */
const GENERIC_CREDIT = /^(זיכוי|העברה|הפקדה|הפקדת|משיכה|ריבית|החזר|פדיון|שיק|המחאה|כספומט|בנקט)/;
const BENEFIT_CREDIT = /(קצבת|קיצבת|ביטוח לאומי|בטוח לאומי|מזונות|מלגה|מענק)/;
/** A candidate this many times the others is flagged, not silently trusted. */
const SALARY_ATYPICAL_RATIO = 10;

function annotateSalaryCandidates(rows: ParsedBankRow[]): ParsedBankRow[] {
  const candidates = rows.filter((row) => {
    if (row.type !== "deposit" || row.lineKind !== "standard" || row.possibleRoundTrip) return false;
    const text = row.description.trim();
    return !GENERIC_CREDIT.test(text) && !BENEFIT_CREDIT.test(text);
  });
  for (const row of candidates) {
    row.salaryCandidate = true;
    row.salaryConfirmed = false;
    const others = candidates.filter((o) => o !== row).map((o) => o.amount);
    if (others.length > 0) {
      const median = [...others].sort((a, b) => a - b)[Math.floor(others.length / 2)]!;
      row.atypicalAmount = median > 0 && row.amount / median >= SALARY_ATYPICAL_RATIO;
    }
    row.note = row.atypicalAmount
      ? "תקבול חריג בגודלו מול שאר התקבולים המזוהים — ממתין לאישור המשתמשת"
      : "תקבול שכר אפשרי — ממתין לאישור המשתמשת";
  }
  return candidates;
}

/**
 * Monthly salary-deposit condition (cumulative salary credits ≥ threshold).
 * Decided from salary deposits alone. A month the file does not cover from its
 * first to its last day is "unknown" — the first one and the last one included:
 * a cumulative monthly rule cannot be settled while the month is still running.
 */
const SALARY_CONDITION_THRESHOLD = 7000;

function evaluateMonthlyConditions(
  rows: ParsedBankRow[],
  coverageFrom: Date | null,
  coverageTo: Date | null
): BankMonthlyCondition[] {
  if (rows.length === 0 || coverageFrom === null || coverageTo === null) return [];

  const salaryByMonth = new Map<string, { total: number; unconfirmed: boolean }>();
  for (const row of rows) {
    if (!row.salaryCandidate) continue;
    const key = monthKey(row.date);
    const bucket = salaryByMonth.get(key) ?? { total: 0, unconfirmed: false };
    bucket.total = round2(bucket.total + row.amount);
    if (!row.salaryConfirmed) bucket.unconfirmed = true;
    salaryByMonth.set(key, bucket);
  }

  const conditions: BankMonthlyCondition[] = [];
  const cursor = new Date(Date.UTC(coverageFrom.getUTCFullYear(), coverageFrom.getUTCMonth(), 1));
  const last = new Date(Date.UTC(coverageTo.getUTCFullYear(), coverageTo.getUTCMonth(), 1));
  const coverage = `${dayKey(coverageFrom)}–${dayKey(coverageTo)}`;
  while (cursor.getTime() <= last.getTime()) {
    const monthStart = new Date(cursor.getTime());
    const monthEnd = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0));
    const fullyCovered =
      coverageFrom.getTime() <= monthStart.getTime() && coverageTo.getTime() >= monthEnd.getTime();
    const month = monthKey(monthStart);
    const bucket = salaryByMonth.get(month) ?? { total: 0, unconfirmed: false };

    let state: BankConditionState;
    let reason: string;
    if (!fullyCovered) {
      state = "unknown";
      reason =
        `החודש אינו מכוסה במלואו בקובץ (טווח ${coverage}) — כלל מצטבר-חודשי ` +
        `אינו ניתן להכרעה לפני סוף החודש`;
    } else if (bucket.total >= SALARY_CONDITION_THRESHOLD) {
      state = "met";
      reason =
        `הפקדות שכר מזוהות ${bucket.total.toFixed(2)} ≥ סף ${SALARY_CONDITION_THRESHOLD}` +
        (bucket.unconfirmed ? " — מבוסס על תקבול שטרם אושר ידנית" : "");
    } else {
      state = "not_met";
      reason = `הפקדות שכר מזוהות ${bucket.total.toFixed(2)} < סף ${SALARY_CONDITION_THRESHOLD}`;
    }

    conditions.push({
      month,
      fullyCovered,
      state,
      salaryTotal: bucket.total,
      threshold: SALARY_CONDITION_THRESHOLD,
      awaitingConfirmation: state === "met" && bucket.unconfirmed,
      reason,
    });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return conditions;
}

/** Split the statement into the buckets of §BankMoneySummary. */
function summarizeMoney(rows: ParsedBankRow[]): BankMoneySummary {
  let depositsRaw = 0;
  let withdrawalsRaw = 0;
  let income = 0;
  let currentSpend = 0;
  let financingCharged = 0;
  let financingRefunded = 0;
  let principal = 0;
  let mixed = 0;
  let roundTripPending = 0;

  for (const row of rows) {
    const isIn = row.type === "deposit"; // physical column — the only direction source
    if (isIn) depositsRaw += row.amount;
    else withdrawalsRaw += row.amount;

    if (isInterestRow(row)) {
      if (isIn) financingRefunded += row.amount;
      else financingCharged += row.amount;
      continue; // interest is financing on both sides — never income, never spending
    }
    if (row.lineKind === "loan_principal") {
      if (!isIn) principal += row.amount;
      continue;
    }
    if (row.lineKind === "loan_mixed") {
      if (!isIn) mixed += row.amount;
      continue;
    }
    if (isIn) income += row.amount;
    else currentSpend += row.amount;
    // Both legs of a round-trip carry the same amount, so counting the incoming
    // leg once gives the sum to hold back from income and from spending alike.
    if (row.possibleRoundTrip && isIn) roundTripPending += row.amount;
  }

  return {
    depositsRaw: round2(depositsRaw),
    withdrawalsRaw: round2(withdrawalsRaw),
    income: round2(income),
    incomeConfirmed: round2(income - roundTripPending),
    currentSpend: round2(currentSpend),
    currentSpendConfirmed: round2(currentSpend - roundTripPending),
    financingCharged: round2(financingCharged),
    financingRefunded: round2(financingRefunded),
    financingNet: round2(financingCharged - financingRefunded),
    principal: round2(principal),
    mixed: round2(mixed),
    roundTripPending: round2(roundTripPending),
  };
}

/** Interest per loan — gross. Credits never reach here: they are account-level. */
function summarizeLoanFinancing(rows: ParsedBankRow[]): BankLoanFinancing[] {
  const byLoan = new Map<string, BankLoanFinancing>();
  for (const row of rows) {
    if (row.lineKind !== "loan_interest" || row.type !== "withdrawal" || row.loanRef === null) continue;
    const entry = byLoan.get(row.loanRef) ?? { loanRef: row.loanRef, interestChargedGross: 0, lines: 0 };
    entry.interestChargedGross = round2(entry.interestChargedGross + row.amount);
    entry.lines += 1;
    byLoan.set(row.loanRef, entry);
  }
  return [...byLoan.values()].sort((a, b) => a.loanRef.localeCompare(b.loanRef));
}

/** The one place netting is allowed: same account, same calendar month. */
function summarizeMonthFinancing(rows: ParsedBankRow[]): BankMonthFinancing[] {
  const byMonth = new Map<string, BankMonthFinancing>();
  for (const row of rows) {
    if (!isInterestRow(row)) continue;
    const key = monthKey(row.date);
    const entry = byMonth.get(key) ?? { month: key, charged: 0, refunded: 0, net: 0 };
    if (row.type === "withdrawal") entry.charged = round2(entry.charged + row.amount);
    else entry.refunded = round2(entry.refunded + row.amount);
    entry.net = round2(entry.charged - entry.refunded);
    byMonth.set(key, entry);
  }
  return [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));
}

// ---------------------------------------------------------------------------
// Built-in integrity check: replay the running balance
// ---------------------------------------------------------------------------

/** Rows scoring below this land in the review queue instead of being trusted. */
const REVIEW_THRESHOLD = 0.7;
/** Balance comparison tolerance (agorot rounding). */
const BALANCE_EPSILON = 0.011;

function signedOf(row: ParsedBankRow): number {
  return row.type === "deposit" ? row.amount : -row.amount;
}

/**
 * Walk the transactions in order, rebuild the running balance and compare it to
 * the balance the bank printed. Statements usually omit the opening balance, so
 * we derive it backwards from the first printed one. Every row is then marked:
 * "printed" (its own balance matched), "chain" (no balance of its own, but a
 * later printed balance confirms the whole segment), "unverified" or "mismatch".
 * A mismatch resyncs the running balance so one bad row can't cascade.
 */
function verifyRollingBalance(rows: ParsedBankRow[]): {
  openingBalance: number | null;
  closingBalance: number | null;
  mismatches: BankBalanceMismatch[];
} {
  const mismatches: BankBalanceMismatch[] = [];
  if (rows.length === 0) return { openingBalance: null, closingBalance: null, mismatches };

  const firstPrinted = rows.findIndex((r) => r.balance !== null);
  if (firstPrinted === -1) {
    for (const row of rows) row.balanceCheck = "unverified";
    applyBalanceConfidence(rows);
    return { openingBalance: null, closingBalance: null, mismatches };
  }

  let opening = rows[firstPrinted]!.balance!;
  for (let i = 0; i <= firstPrinted; i += 1) opening -= signedOf(rows[i]!);
  opening = round2(opening);

  let running = opening;
  let segmentStart = 0; // first row not yet confirmed by a printed balance
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i]!;
    running = round2(running + signedOf(row));
    if (row.balance === null) {
      row.balanceCheck = "unverified";
      continue;
    }
    const diff = round2(row.balance - running);
    if (Math.abs(diff) > BALANCE_EPSILON) {
      row.balanceCheck = "mismatch";
      mismatches.push({
        index: i,
        date: row.date.toISOString().slice(0, 10),
        description: row.description,
        expected: running,
        printed: row.balance,
        diff,
      });
      running = row.balance; // resync
    } else {
      row.balanceCheck = "printed";
      for (let j = segmentStart; j < i; j += 1) {
        if (rows[j]!.balanceCheck === "unverified") rows[j]!.balanceCheck = "chain";
      }
    }
    segmentStart = i + 1;
  }

  applyBalanceConfidence(rows);
  return { openingBalance: opening, closingBalance: round2(running), mismatches };
}

const BALANCE_CONFIDENCE_FACTOR: Record<BankBalanceCheck, number> = {
  printed: 1,
  chain: 1,
  unverified: 0.8,
  mismatch: 0.3,
};

function applyBalanceConfidence(rows: ParsedBankRow[]): void {
  for (const row of rows) {
    row.confidence = round2(Math.min(1, row.confidence * BALANCE_CONFIDENCE_FACTOR[row.balanceCheck]));
  }
}

const BALANCE_CHECK_REASON: Record<BankBalanceCheck, string> = {
  printed: "יתרה מודפסת תואמת",
  chain: "אומת דרך היתרה של השורה הבאה",
  unverified: "אין יתרה מודפסת לאימות",
  mismatch: "היתרה המודפסת לא תואמת לחישוב",
};

/**
 * Run the integrity check, score the review queue and assemble the ingestion
 * report. Single place — every parser path funnels through here.
 */
function buildStatement(
  parser: BankIngestionReport["parser"],
  parserLabel: string,
  rows: ParsedBankRow[],
  rejected: BankRowIssue[]
): ParsedBankStatement {
  const { openingBalance, closingBalance, mismatches } = verifyRollingBalance(rows);

  // Analysis order matters: account-level credits first (they clear a loanRef),
  // then round-trips (they disqualify a credit from being a salary candidate),
  // then salary candidates (they decide the monthly condition).
  annotateAccountLevelCredits(rows);
  const roundTrips = annotateRoundTrips(rows);
  const candidates = annotateSalaryCandidates(rows);

  const dates = rows.map((r) => r.date.getTime());
  const coverageFrom = dates.length > 0 ? new Date(Math.min(...dates)) : null;
  const coverageTo = dates.length > 0 ? new Date(Math.max(...dates)) : null;

  const byLineKind: Record<BankLineKind, number> = {
    standard: 0,
    loan_principal: 0,
    loan_interest: 0,
    overdraft_interest: 0,
    loan_mixed: 0,
  };
  const review: BankRowIssue[] = [];

  for (const row of rows) {
    byLineKind[row.lineKind] += 1;
    // A loan payment arriving as a credit is a drawdown, not a repayment — the
    // buckets below only count the debit direction, so surface it for a human.
    if (row.type === "deposit" && (row.lineKind === "loan_principal" || row.lineKind === "loan_mixed")) {
      review.push({
        page: typeof row.raw.page === "number" ? row.raw.page : null,
        line: `${dayKey(row.date)} ${row.description} ${row.amount}`,
        reason: "שורת קרן/תשלום הלוואה בכיוון זכות — לא נספרה כהחזר, דורשת בדיקה ידנית",
      });
    }
    if (row.confidence < REVIEW_THRESHOLD) {
      const page = typeof row.raw.page === "number" ? row.raw.page : null;
      const reasonHint = typeof row.raw.columnHint === "string" ? row.raw.columnHint : null;
      review.push({
        page,
        line: `${row.date.toISOString().slice(0, 10)} ${row.description} ${row.amount}`,
        reason: [
          `ביטחון ${row.confidence}`,
          reasonHint,
          BALANCE_CHECK_REASON[row.balanceCheck],
        ]
          .filter(Boolean)
          .join(" · "),
      });
    }
  }

  return {
    rows,
    report: {
      parser,
      parserLabel,
      rowsDetected: rows.length,
      rowsRejected: rejected.length,
      rejected,
      review,
      balanceMismatches: mismatches,
      openingBalance,
      closingBalance,
      coverageFrom: coverageFrom === null ? null : dayKey(coverageFrom),
      coverageTo: coverageTo === null ? null : dayKey(coverageTo),
      money: summarizeMoney(rows),
      loanFinancing: summarizeLoanFinancing(rows),
      monthFinancing: summarizeMonthFinancing(rows),
      roundTrips,
      salaryCandidates: candidates.map((row) => ({
        page: typeof row.raw.page === "number" ? row.raw.page : null,
        line: `${dayKey(row.date)} ${row.description} ${row.amount.toFixed(2)}`,
        reason: row.note ?? "תקבול שכר אפשרי — ממתין לאישור המשתמשת",
      })),
      monthlyConditions: evaluateMonthlyConditions(rows, coverageFrom, coverageTo),
      byLineKind,
    },
  };
}

/** Summary/footer rows that must not become transactions. */
const SUMMARY_ROW_PATTERNS = [/סה["״']?כ/, /^סך/, /^total/i, /יתרת פתיחה/, /יתרת סגירה/, /יתרה קודמת/];

function isSummaryRow(text: string): boolean {
  return SUMMARY_ROW_PATTERNS.some((pattern) => pattern.test(text.trim()));
}

/**
 * Parse an Israeli current-account (עו״ש) statement into transactions.
 * Money-in becomes a "deposit", money-out a "withdrawal" — so a single file
 * feeds both the income and expense sides of the account.
 */
export function parseBankStatement(buffer: Buffer): ParsedBankStatement {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  } catch {
    throw ApiError.badRequest("הקובץ אינו קובץ אקסל תקין");
  }

  const parsed: ParsedBankRow[] = [];
  const rejected: BankRowIssue[] = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const rows = XLSX.utils.sheet_to_json<Cell[]>(sheet, { header: 1, defval: null });
    const header = findHeaderRow(rows);
    if (!header) continue;
    const cols = header.columns;

    for (let i = header.rowIndex + 1; i < rows.length; i += 1) {
      const row = rows[i] ?? [];
      if (row.every((cell) => cell === null || String(cell).trim() === "")) continue;

      const date = parseCellDate(row[cols.date!]);
      if (!date) continue;
      const description = String(row[cols.description ?? cols.date!] ?? "").trim() || "תנועה בחשבון";
      if (isSummaryRow(description)) continue;

      let amount: number | null = null;
      let type: BankTransactionKind | null = null;
      // Split debit/credit columns are authoritative; a single signed סכום
      // column is the next best thing (the sign is still the bank's, not ours).
      let confidence = 1;

      if (cols.debit !== undefined || cols.credit !== undefined) {
        const debit = cols.debit !== undefined ? parseSignedAmount(row[cols.debit]) : null;
        const credit = cols.credit !== undefined ? parseSignedAmount(row[cols.credit]) : null;
        if (credit && Math.abs(credit) > 0) {
          amount = Math.abs(credit);
          type = "deposit";
        } else if (debit && Math.abs(debit) > 0) {
          amount = Math.abs(debit);
          type = "withdrawal";
        }
      } else if (cols.amount !== undefined) {
        const signed = parseSignedAmount(row[cols.amount]);
        if (signed && signed !== 0) {
          amount = Math.abs(signed);
          type = signed > 0 ? "deposit" : "withdrawal";
          confidence = 0.9;
        }
      }

      if (amount === null || type === null) {
        rejected.push({
          page: null,
          line: `${sheetName} שורה ${i + 1}: ${description}`,
          reason: "לא נמצא סכום בעמודת חובה/זכות/סכום",
        });
        continue;
      }

      const balance = cols.balance !== undefined ? parseSignedAmount(row[cols.balance]) : null;
      const { lineKind, loanRef } = classifyLineKind(description);
      parsed.push(
        toRow({
          date,
          description,
          amount,
          type,
          lineKind,
          loanRef,
          balance,
          confidence,
          balanceCheck: "unverified",
          raw: Object.fromEntries(
            row.map((cell, c) => [String(c), cell instanceof Date ? cell.toISOString() : cell])
          ),
        })
      );
    }
  }

  if (parsed.length === 0) {
    throw ApiError.badRequest(
      "לא נמצאו תנועות בקובץ (נדרשות עמודות: תאריך, ותנועה עם חובה/זכות או סכום)"
    );
  }
  return buildStatement("excel", "קורא אקסל (עמודות חובה/זכות)", parsed, rejected);
}

// ---------------------------------------------------------------------------
// PDF statement parsing
// ---------------------------------------------------------------------------

/** A date token like 24/07/26 or 24.07.2026 anywhere in a line. */
const DATE_TOKEN = /(\d{1,2})[./](\d{1,2})[./](\d{2,4})/;
/** A money token: 1,234.56 / 1234 / -50.00 (kept with sign). */
const MONEY_TOKEN = /-?\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|-?\d+(?:\.\d{1,2})?/g;
/** Opening-balance lines used to seed the running balance (not transactions). */
const OPENING_BALANCE = /(יתרת פתיחה|יתרה קודמת|יתרה קודמ|יתרה לתחילת|balance forward)/i;

function parseDmy(token: string): Date | null {
  const m = DATE_TOKEN.exec(token);
  if (!m) return null;
  let year = Number(m[3]);
  if (year < 100) year += 2000;
  const month = Number(m[2]);
  const day = Number(m[1]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return new Date(Date.UTC(year, month - 1, day));
}

/** Extract money numbers from a line AFTER stripping any date tokens. */
function moneyNumbers(line: string): number[] {
  const withoutDates = line.replace(new RegExp(DATE_TOKEN.source, "g"), " ");
  const matches = withoutDates.match(MONEY_TOKEN) ?? [];
  return matches
    .map((t) => parseMoneyText(t))
    .filter((n): n is number => n !== null);
}

/** Money-in / money-out hints from the description text (weak fallback signal). */
function keywordType(text: string): BankTransactionKind | null {
  if (/(זכות|הפקדה|משכורת|קצבה|העברה לזכות|זיכוי|ריבית זכות|קבלת)/.test(text)) return "deposit";
  if (/(חובה|משיכה|תשלום|רכישה|קניה|עמלה|חיוב|כרטיס|המחאה|שיק)/.test(text)) return "withdrawal";
  return null;
}

/**
 * Fallback parser for PDF statements that carry no recoverable column layout.
 *
 * We work line-by-line: a transaction line starts with a date and carries one or
 * two money numbers. When the statement prints a running balance we classify each
 * row by the change in balance; otherwise we fall back to an explicit sign or
 * description keywords. This is a best-effort last resort — the positional parser
 * (parseBankStatementPdfByColumns) is tried first and is far more reliable, since
 * it reads the debit/credit column each amount actually sits in. Rows classified
 * by keywords alone are pushed into the review queue: they are a guess, and a
 * guess must be visible.
 */
async function parseBankStatementPdfByText(buffer: Buffer): Promise<ParsedBankStatement> {
  let text: string;
  try {
    text = (await pdfParse(buffer)).text;
  } catch {
    throw ApiError.badRequest("לא ניתן לקרוא את קובץ ה-PDF");
  }

  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  // Candidate transaction lines: must contain a date and at least one number.
  interface Candidate {
    date: Date;
    description: string;
    numbers: number[];
  }
  const candidates: Candidate[] = [];
  const rejected: BankRowIssue[] = [];
  let seedBalance: number | null = null;

  for (const line of lines) {
    if (isSummaryRow(line) && !DATE_TOKEN.test(line)) {
      const nums = moneyNumbers(line);
      if (OPENING_BALANCE.test(line) && nums.length > 0) seedBalance = nums[nums.length - 1]!;
      continue;
    }
    const dateMatch = DATE_TOKEN.exec(line);
    if (!dateMatch) continue;
    const date = parseDmy(dateMatch[0]);
    if (!date) continue;
    const numbers = moneyNumbers(line);
    if (numbers.length === 0) {
      rejected.push({ page: null, line, reason: "שורה עם תאריך אך ללא סכום" });
      continue;
    }

    // Description = the line with date tokens and money numbers stripped out.
    const description =
      line
        .replace(new RegExp(DATE_TOKEN.source, "g"), " ")
        .replace(MONEY_TOKEN, " ")
        .replace(/\s+/g, " ")
        .trim() || "תנועה בחשבון";
    candidates.push({ date, description, numbers });
  }

  // Does the statement print a running-balance column? True when most rows carry
  // two-plus numbers (amount + balance).
  const multiNumberShare =
    candidates.filter((c) => c.numbers.length >= 2).length / (candidates.length || 1);
  const hasBalanceColumn = candidates.length > 0 && multiNumberShare >= 0.6;

  const parsed: ParsedBankRow[] = [];
  let prevBalance = seedBalance;

  for (const c of candidates) {
    let amount: number;
    let type: BankTransactionKind;
    let balance: number | null = null;
    let confidence: number;
    let columnHint: string;

    if (hasBalanceColumn && c.numbers.length >= 2) {
      balance = c.numbers[c.numbers.length - 1]!;
      const printedAmount = Math.abs(c.numbers[c.numbers.length - 2]!);
      if (prevBalance !== null) {
        const delta = round2(balance - prevBalance);
        type = delta >= 0 ? "deposit" : "withdrawal";
        // Trust the balance delta for the amount when it agrees with the printed
        // figure (guards against a stray number); else keep the printed amount.
        amount = Math.abs(delta) > 0 ? Math.abs(delta) : printedAmount;
        confidence = 0.75;
        columnHint = "כיוון נגזר משינוי היתרה";
      } else {
        // First row with no seed: fall back to sign / keywords, default withdrawal.
        const signed = c.numbers[c.numbers.length - 2]!;
        type = signed < 0 ? "withdrawal" : keywordType(c.description) ?? "withdrawal";
        amount = printedAmount;
        confidence = signed < 0 ? 0.6 : 0.35;
        columnHint = "שורה ראשונה ללא יתרת פתיחה";
      }
      prevBalance = balance;
    } else {
      // No balance column: use the largest-magnitude number as the amount.
      const signed = c.numbers.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a), c.numbers[0]!);
      amount = Math.abs(signed);
      type = signed < 0 ? "withdrawal" : keywordType(c.description) ?? "withdrawal";
      confidence = signed < 0 ? 0.6 : 0.35;
      columnHint = signed < 0 ? "כיוון נקבע לפי סימן הסכום" : "כיוון נקבע לפי טקסט — לא לפי עמודה";
    }

    if (!(amount > 0)) {
      rejected.push({ page: null, line: c.description, reason: "סכום אפס או לא תקין" });
      continue;
    }
    const { lineKind, loanRef } = classifyLineKind(c.description);
    parsed.push(
      toRow({
        date: c.date,
        description: c.description,
        amount: round2(amount),
        type,
        lineKind,
        loanRef,
        balance,
        confidence,
        balanceCheck: "unverified",
        raw: { line: c.description, numbers: c.numbers, columnHint },
      })
    );
  }

  return buildStatement("pdf-text", "קורא PDF טקסטואלי (מסלול גיבוי)", parsed, rejected);
}

// ---------------------------------------------------------------------------
// Positional PDF parsing (primary)
//
// Israeli bank statements (tested against First International / הבינלאומי) print
// a real table whose columns — זכות (credit), חובה (debit), יתרה (balance) — are
// only distinguishable by their x-position. Plain text extraction glues the
// amount, balance and reference numbers together and loses which column each
// amount came from, so income and expenses become indistinguishable. Here we
// keep every text token's x/y and reconstruct the table: the column an amount
// sits in tells us deposit vs. withdrawal directly — the authoritative signal.
// This path NEVER falls back to description keywords: a row whose amount cannot
// be tied to a column is reported, not guessed.
// ---------------------------------------------------------------------------

interface TextItem {
  s: string;
  x: number;
  y: number;
  cx: number; // horizontal centre
  right: number; // right edge — money columns are right-aligned, so this is sharper
  page: number;
}

const FULL_DATE = /^\d{1,2}\/\d{1,2}\/\d{2,4}$/;

/** Pull every text token out of the PDF with its position (x/y per page). */
async function extractPositionedItems(buffer: Buffer): Promise<TextItem[]> {
  const items: TextItem[] = [];
  let page = 0;
  const pagerender = (pageData: {
    getTextContent: (opts: unknown) => Promise<{ items: Array<{ str: string; transform: number[]; width: number }> }>;
  }): Promise<string> =>
    pageData
      .getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false })
      .then((content) => {
        const p = page;
        page += 1;
        for (const it of content.items) {
          const s = String(it.str ?? "").trim();
          if (!s) continue;
          const x = it.transform[4]!;
          const y = it.transform[5]!;
          const w = it.width ?? 0;
          items.push({ s, x, y, cx: x + w / 2, right: x + w, page: p });
        }
        return "";
      });
  await pdfParse(buffer, { pagerender });
  return items;
}

/** Money column geometry taken from the header labels (they sit above the data). */
interface MoneyColumn {
  role: "debit" | "credit" | "balance";
  cx: number;
  right: number;
}

/** A numeric token belongs to a money column only if it lines up with it. */
const COLUMN_TOL = 40; // beyond this the token is a reference/code number
const COLUMN_TIGHT = 12; // within this the match is unambiguous

function columnDistance(item: { cx: number; right: number }, column: MoneyColumn): number {
  // Amounts are right-aligned under a right-aligned header, so the right edge is
  // the sharpest signal; the centre is kept as a fallback for centred layouts.
  return Math.min(Math.abs(item.right - column.right), Math.abs(item.cx - column.cx));
}

function distanceConfidence(distance: number): number {
  if (distance <= COLUMN_TIGHT) return 1;
  return round2(1 - (0.6 * (distance - COLUMN_TIGHT)) / (COLUMN_TOL - COLUMN_TIGHT));
}

/** Reconstruct the statement table from positioned tokens and classify each
 *  amount by the column (credit/debit) it physically occupies. */
function parseBankStatementPdfByColumns(items: TextItem[]): ParsedBankStatement | null {
  // Locate the header row — the one carrying both חובה and זכות labels. It is
  // usually printed on the first page only; its x-positions apply to every page.
  const byRow = new Map<string, TextItem[]>();
  for (const it of items) {
    const key = `${it.page}:${Math.round(it.y)}`;
    (byRow.get(key) ?? byRow.set(key, []).get(key)!).push(it);
  }

  const columns: MoneyColumn[] = [];
  let headerPage: number | null = null;
  let headerY: number | null = null;
  let creditRight: number | null = null;
  for (const row of byRow.values()) {
    const debit = row.find((i) => i.s === "חובה");
    const credit = row.find((i) => i.s === "זכות");
    if (!debit || !credit) continue;
    columns.push({ role: "debit", cx: debit.cx, right: debit.right });
    columns.push({ role: "credit", cx: credit.cx, right: credit.right });
    const balance = row.find((i) => i.s === "יתרה");
    if (balance) columns.push({ role: "balance", cx: balance.cx, right: balance.right });
    headerPage = debit.page;
    headerY = debit.y;
    creditRight = credit.right;
    break;
  }
  if (creditRight === null || headerY === null) return null; // not this layout → caller falls back

  // Description text sits to the right of the credit column (higher x).
  const descLeftBound = creditRight + 18;

  interface Anchor {
    page: number;
    y: number;
    date: Date;
    amount: number;
    type: BankTransactionKind;
    balance: number | null;
    confidence: number;
    columnHint: string;
    desc: TextItem[];
  }
  const anchors: Anchor[] = [];
  const rejected: BankRowIssue[] = [];

  const bodyRows = [...byRow.values()]
    .filter((row) => {
      const first = row[0]!;
      // Everything printed above the header on the header page is metadata.
      return !(first.page === headerPage && first.y >= headerY!);
    })
    .sort((a, b) => a[0]!.page - b[0]!.page || b[0]!.y - a[0]!.y);

  for (const row of bodyRows) {
    const dateTok = row
      .filter((i) => FULL_DATE.test(i.s))
      .sort((a, b) => b.x - a.x)[0]; // transaction date is the right-most one
    if (!dateTok) continue;
    const date = parseDmy(dateTok.s);
    if (!date) continue;

    const ownDesc = row.filter((i) => i.cx > descLeftBound && !FULL_DATE.test(i.s));
    const rowText = () =>
      [dateTok.s, ...ownDesc.sort((p, q) => q.x - p.x).map((i) => i.s)].join(" ");

    // Match every numeric token to the money column it physically sits in.
    let money: { value: number; role: MoneyColumn["role"]; distance: number } | null = null;
    let balance: number | null = null;
    let ambiguous = false;
    const strays: string[] = [];
    for (const it of row) {
      if (FULL_DATE.test(it.s)) continue;
      const value = parseMoneyText(it.s);
      if (value === null) continue;
      let best: { column: MoneyColumn; distance: number } | null = null;
      for (const column of columns) {
        const distance = columnDistance(it, column);
        if (best === null || distance < best.distance) best = { column, distance };
      }
      if (!best || best.distance > COLUMN_TOL) {
        if (Math.abs(value) > 0) strays.push(it.s);
        continue;
      }
      if (best.column.role === "balance") {
        balance = value;
        continue;
      }
      if (Math.abs(value) === 0) continue;
      if (money !== null) {
        // Two amounts landed in money columns — keep the better-aligned one and
        // flag the row so a human can look at it.
        ambiguous = true;
        if (best.distance >= money.distance) continue;
      }
      money = { value: Math.abs(value), role: best.column.role, distance: best.distance };
    }

    if (money === null) {
      if (isSummaryRow(rowText())) continue;
      rejected.push({
        page: dateTok.page,
        line: rowText(),
        reason: strays.length
          ? `סכומים לא נפלו בעמודת זכות/חובה: ${strays.join(", ")}`
          : "לא נמצא סכום בעמודת זכות/חובה",
      });
      continue;
    }

    let confidence = distanceConfidence(money.distance);
    let columnHint = `עמודת ${money.role === "credit" ? "זכות" : "חובה"} (מרחק ${round2(money.distance)})`;
    if (ambiguous) {
      confidence = round2(confidence * 0.5);
      columnHint += " · יותר מסכום אחד בעמודות הכסף";
    }

    anchors.push({
      page: dateTok.page,
      y: dateTok.y,
      date,
      amount: money.value,
      type: money.role === "credit" ? "deposit" : "withdrawal",
      balance,
      confidence,
      columnHint,
      desc: ownDesc,
    });
  }

  if (anchors.length === 0) return null;

  // Descriptions often wrap onto neighbouring lines that carry no amount. Attach
  // each stray description fragment to the closest anchor on the same page.
  const MAX_DESC_GAP = 22;
  for (const row of byRow.values()) {
    for (const it of row) {
      if (it.cx <= descLeftBound || FULL_DATE.test(it.s)) continue;
      // Skip fragments that already belong to an anchor row.
      if (anchors.some((a) => a.page === it.page && Math.round(a.y) === Math.round(it.y))) continue;
      let best: Anchor | null = null;
      let bestGap = MAX_DESC_GAP;
      for (const a of anchors) {
        if (a.page !== it.page) continue;
        const gap = Math.abs(a.y - it.y);
        if (gap < bestGap) {
          bestGap = gap;
          best = a;
        }
      }
      if (best) best.desc.push(it);
    }
  }

  const rows = anchors.map<ParsedBankRow>((a) => {
    // Read top-to-bottom, then right-to-left (RTL) within a line.
    const description =
      a.desc
        .sort((p, q) => (Math.abs(p.y - q.y) > 2 ? q.y - p.y : q.x - p.x))
        .map((i) => i.s)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim() || "תנועה בחשבון";
    const { lineKind, loanRef } = classifyLineKind(description);
    return toRow({
      date: a.date,
      description,
      amount: round2(a.amount),
      type: a.type,
      lineKind,
      loanRef,
      balance: a.balance,
      confidence: a.confidence,
      balanceCheck: "unverified",
      raw: {
        page: a.page,
        y: a.y,
        amount: a.amount,
        balance: a.balance,
        description,
        columnHint: a.columnHint,
      },
    });
  });

  return buildStatement("pdf-columns", "קורא PDF עמודתי (מיקום זכות/חובה)", rows, rejected);
}

/**
 * Parse an Israeli current-account (עו״ש) statement in PDF form. We first try a
 * positional read that recovers the real debit/credit columns; if the statement
 * doesn't expose that layout we fall back to a line-by-line text heuristic.
 * Output matches the Excel parser, so the import flow (dedup, categorization,
 * balance update) is shared.
 */
export async function parseBankStatementPdf(buffer: Buffer): Promise<ParsedBankStatement> {
  let positioned: ParsedBankStatement | null = null;
  try {
    const items = await extractPositionedItems(buffer);
    positioned = parseBankStatementPdfByColumns(items);
  } catch {
    positioned = null;
  }
  if (positioned && positioned.rows.length > 0) return positioned;

  const byText = await parseBankStatementPdfByText(buffer);
  if (byText.rows.length > 0) return byText;

  throw ApiError.badRequest(
    "לא זוהו תנועות ב-PDF. ודאי שזה פירוט תנועות עו״ש (עם תאריך, תיאור וסכום). אם הבעיה חוזרת—שלחי לי דוגמה ואתאים את הקורא."
  );
}

const CONDITION_LABEL: Record<BankConditionState, string> = {
  met: "התקיים",
  not_met: "לא התקיים",
  unknown: "לא ידוע",
};

/** One-line Hebrew summary of an ingestion report, for the server log. */
export function describeIngestionReport(report: BankIngestionReport): string {
  const kinds = Object.entries(report.byLineKind)
    .filter(([, count]) => count > 0)
    .map(([kind, count]) => `${kind}=${count}`)
    .join(", ");
  const m = report.money;
  return [
    `פרסר: ${report.parserLabel}`,
    `זוהו ${report.rowsDetected} תנועות`,
    `נדחו ${report.rowsRejected}`,
    `לבדיקה ${report.review.length}`,
    `אי-התאמות יתרה ${report.balanceMismatches.length}`,
    `יתרה סופית ${report.closingBalance ?? "לא ידועה"}`,
    `${BANK_MONEY_LABELS.income} ${m.income.toFixed(2)}`,
    `${BANK_MONEY_LABELS.currentSpend} ${m.currentSpend.toFixed(2)}`,
    `${BANK_MONEY_LABELS.financingCharged} ${m.financingCharged.toFixed(2)}`,
    `${BANK_MONEY_LABELS.financingRefunded} ${m.financingRefunded.toFixed(2)}`,
    `${BANK_MONEY_LABELS.financingNet} ${m.financingNet.toFixed(2)}`,
    `${BANK_MONEY_LABELS.principal} ${m.principal.toFixed(2)}`,
    `${BANK_MONEY_LABELS.mixed} ${m.mixed.toFixed(2)}`,
    kinds ? `סוגי שורות: ${kinds}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Hebrew lines describing the monthly salary-deposit condition, for the log. */
export function describeMonthlyConditions(report: BankIngestionReport): string[] {
  return report.monthlyConditions.map(
    (c) => `${c.month}: ${CONDITION_LABEL[c.state]}${c.awaitingConfirmation ? " (ממתין לאישור)" : ""} — ${c.reason}`
  );
}
