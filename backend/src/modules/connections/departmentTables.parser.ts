// Pure: the cell text TABLE_CELLS read on a landed department page, turned into a fixed shape inside the
// worker (CLAUDE.md §7 A2). Driven by the bank's own column labels; a table it cannot place is UNAVAILABLE, never guessed.
import type { ScrapedLoan, ScrapedStandingOrder } from "../../types/connections.types";

export type CellTables = readonly (readonly (readonly string[])[])[];
/** Null = the page held no table this parser recognises (UNAVAILABLE). */
export type TableParse<T> = { items: T[]; rejected: number } | null;

export const MAX_LOANS = 50;
export const MAX_STANDING_ORDERS = 100;
const TEXT_MAX = 60;
const HEADER_ROWS = 5;

const BIDI = /[‎‏‪-‮⁦-⁩]/g;
// Labels are matched without quotes or geresh, so מס' / מס׳ / מס are one label.
const QUOTES = /["'`׳״“”‘’]/g;
const norm = (text: string) => text.replace(BIDI, "").replace(QUOTES, "").replace(/\s+/g, " ").trim();

/** Shekels as the bank prints them: ₪/ש"ח, thousands commas, a leading, trailing or Unicode minus, or parentheses. */
export function parseAmount(text: string): number | null {
  let t = norm(text).replace(/₪|שח|NIS|ILS/gi, "").replace(/[\s,]/g, "");
  let negative = false;
  const paren = /^\((.*)\)$/.exec(t);
  if (paren) { negative = true; t = paren[1]; }
  const signed = /^([-−–]?)(\d+(?:\.\d+)?)([-−–]?)$/.exec(t);
  if (!signed || (signed[1] && signed[3])) return null;
  const value = Number(signed[2]);
  return Number.isFinite(value) ? (negative || signed[1] || signed[3] ? -value : value) : null;
}

/** A plain percent (6.5, "6.50%"); "פריים + 1.5" is not a rate. */
export function parsePercent(text: string): number | null {
  const t = norm(text).replace(/[%\s]/g, "");
  if (!/^-?\d+(?:\.\d+)?$/.test(t)) return null;
  const value = Number(t);
  return Math.abs(value) <= 100 ? value : null;
}

/** dd/mm/yyyy, dd.mm.yy, dd-mm-yyyy → YYYY-MM-DD; anything that is not a real day is null. */
export function parseDate(text: string): string | null {
  const m = /^(\d{1,2})(?:\.|\/|-)(\d{1,2})(?:\.|\/|-)(\d{4}|\d{2})$/.exec(norm(text));
  if (!m) return null;
  const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const month = Number(m[2]);
  const day = Number(m[1]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

const parseCount = (text: string) => (/^\d{1,4}$/.test(norm(text)) ? Number(norm(text)) : null);
const abs = (value: number | null) => (value === null ? null : Math.abs(value));

/** CLAUDE.md §7 A2: an account, loan or reference number leaves the worker as its last 4 digits only. */
export function lastFour(text: string): string | null {
  const digits = norm(text).replace(/\D/g, "");
  return digits ? digits.slice(-4) : null;
}

// Digits joined by spaces, dashes, slashes, dots, commas or quote marks are one number: "12-345-678" is 8 digits.
const DIGIT_GROUP = /\d(?:[\s./,_\-\u2010-\u2015\u2212"'`\u05f3\u05f4]*\d)*/g;
const isLongGroup = (group: string) => group.replace(/\D/g, "").length > 4;

/** §7 A2: text that still holds a number longer than 4 digits. The worker's plainText and the parent's schema share it. */
export function hasLongNumber(text: string): boolean {
  return (text.replace(BIDI, "").match(DIGIT_GROUP) ?? []).some(isLongGroup);
}

/** A name for her to recognise, with any number longer than 4 digits (an account or ID) dropped. */
export function plainText(text: string): string | null {
  const cleaned = text.replace(BIDI, "")
    .replace(DIGIT_GROUP, (group) => (isLongGroup(group) ? " " : group))
    .replace(/\s+/g, " ").trim().slice(0, TEXT_MAX).trim();
  return cleaned || null;
}

type Columns<F extends string> = Partial<Record<F, number>>;

/** A field, the words that place it (most specific first), and words that rule a label out for it alone. */
type FieldSpec<F extends string> = readonly [F, readonly string[], (readonly string[])?];

/**
 * Every column whose label holds an excluded word is out first, whatever else it says. Then fields in priority
 * order, each taking the first free column whose label holds one of its words, most specific word first:
 * "יתרת קרן" is placed before a bare "יתרה" can claim it. Substrings, not \b (Hebrew).
 */
function placeColumns<F extends string>(header: readonly string[], fields: readonly FieldSpec<F>[], excluded: readonly string[]): Columns<F> {
  const labels = header.map(norm);
  const taken = new Set(labels.flatMap((label, i) => (excluded.some((word) => label.includes(word)) ? [i] : [])));
  const columns: Columns<F> = {};
  for (const [field, words, not = []] of fields) {
    for (const word of words) {
      const index = labels.findIndex((label, i) => !taken.has(i) && label.includes(word) && !not.some((other) => label.includes(other)));
      if (index >= 0) { columns[field] = index; taken.add(index); break; }
    }
  }
  return columns;
}

interface Layout<F extends string> {
  fields: readonly FieldSpec<F>[];
  excluded: readonly string[];
  required: (columns: Columns<F>) => boolean;
  max: number;
}

function parseTables<F extends string, T>(tables: CellTables, layout: Layout<F>, rowOf: (cell: (field: F) => string | null) => T | null): TableParse<T> {
  const items: T[] = [];
  const seen = new Set<string>();
  let rejected = 0;
  let recognised = false;
  for (const table of tables) {
    const headerAt = table.slice(0, HEADER_ROWS).findIndex((row) => layout.required(placeColumns(row, layout.fields, layout.excluded)));
    if (headerAt < 0) continue;
    recognised = true;
    const header = table[headerAt];
    const columns = placeColumns(header, layout.fields, layout.excluded);
    const headerText = header.map(norm).join("|");
    for (const row of table.slice(headerAt + 1)) {
      const texts = row.map(norm);
      if (texts.every((text) => !text) || texts.join("|") === headerText) continue;
      const first = texts.find(Boolean) ?? "";
      if (first.includes("סהכ") || first.includes("סך הכל")) continue;
      // A row that does not line up with its header would put a value under the wrong label.
      if (row.length !== header.length) { rejected += 1; continue; }
      const item = rowOf((field) => { const index = columns[field]; return index === undefined ? null : row[index]; });
      if (!item) { rejected += 1; continue; }
      const key = JSON.stringify(item);
      if (!seen.has(key)) { seen.add(key); items.push(item); }
    }
  }
  if (!recognised || !items.length || items.length > layout.max) return null;
  return { items, rejected };
}

type LoanField = "trackNumber" | "loanNumber" | "interestKind" | "primeMargin" | "annualInterestRate" | "linkage" | "track" | "name"
  | "originalAmount" | "indexedBalance" | "principalBalance" | "nextPaymentDate" | "nextPaymentAmount" | "paymentsMade" | "paymentsLeft"
  | "paymentsTotal" | "startDate" | "endDate";

// Banker 2026-11-14: a payoff amount carries early-repayment fees, accrued interest and linkage, and arrears or a
// ceiling is no balance at all, so these columns feed no field. A principal part of a payment is not the balance.
// A balance "including interest" is neither principal nor the linked balance ("כולל הצמדה" stays the latter).
const LOAN_EXCLUDED = ["סילוק", "פירעון מוקדם", "פרעון מוקדם", "פיגור", "תקרה", "תקרת", "מרבי", "החזר קרן", "תשלום קרן",
  "כולל ריבית", "כוללת", "ריבית צבורה"];

const LOAN_FIELDS: readonly FieldSpec<LoanField>[] = [
  ["trackNumber", ["מספר מסלול", "מס מסלול"]],
  ["loanNumber", ["מספר הלוואה", "מספר ההלוואה", "מס הלוואה", "מספר חשבון הלוואה"]],
  ["interestKind", ["סוג ריבית", "סוג הריבית", "בסיס ריבית"]],
  ["primeMargin", ["מרווח", "פריים"]],
  // Banker 2026-11-16: an interest amount (accrued, due, paid) is no rate, and an effective rate is not the loan's.
  ["annualInterestRate", ["שיעור ריבית", "שיעור הריבית", "ריבית שנתית", "ריבית נומינלית", "ריבית"], ["סכום", "צבור", "שנצבר", "לתשלום", "תשלום", "שולמ", "אפקטיבית"]],
  // Before linkage, so "יתרה כולל הצמדה" is the revalued balance rather than the linkage flag.
  ["indexedBalance", ["יתרה צמודה", "יתרת קרן צמודה", "כולל הצמדה", "משוערכת"]],
  ["linkage", ["הצמדה", "צמוד"]],
  ["track", ["מסלול"]],
  ["name", ["סוג הלוואה", "סוג ההלוואה", "שם הלוואה", "שם ההלוואה", "מטרת"]],
  ["originalAmount", ["סכום מקורי", "סכום ההלוואה", "סכום הלוואה", "קרן מקורית", "סכום מקור"]],
  ["principalBalance", ["יתרת קרן", "יתרת הקרן", "יתרה", "קרן"]],
  ["nextPaymentDate", ["מועד תשלום הבא", "תאריך תשלום הבא", "מועד התשלום הבא", "תאריך התשלום הבא", "מועד חיוב הבא", "תאריך חיוב הבא"]],
  ["nextPaymentAmount", ["תשלום חודשי", "החזר חודשי", "סכום תשלום הבא", "סכום התשלום הבא", "תשלום הבא", "סכום תשלום"]],
  ["paymentsMade", ["תשלומים ששולמו", "שולמו"]],
  ["paymentsLeft", ["תשלומים שנותרו", "נותרו", "יתרת תשלומים"]],
  ["paymentsTotal", ["מספר תשלומים", "מס תשלומים", "סהכ תשלומים", "תקופה בחודשים", "תקופת ההלוואה"]],
  ["startDate", ["תאריך העמדה", "מועד העמדה", "תאריך התחלה", "תאריך מתן"]],
  ["endDate", ["תאריך סיום", "מועד סיום", "תאריך פירעון סופי", "מועד פירעון סופי", "תום תקופה"]],
];

const PRIME_MARGIN = /(?:פריים|\bprime|\bP)\s*([+\-−])\s*(\d+(?:\.\d+)?)/i;

function interestTypeOf(text: string): ScrapedLoan["interestType"] {
  if (/פריים|\bprime\b|\bP\s*[+\-−]/i.test(text)) return "prime";
  if (text.includes("קבוע")) return "fixed";
  if (text.includes("משתנ")) return "variable";
  return null;
}

function marginOf(marginCell: string | null, texts: readonly string[]): number | null {
  for (const text of [marginCell ?? "", ...texts]) {
    const m = PRIME_MARGIN.exec(norm(text));
    if (m) return (m[1] === "+" ? 1 : -1) * Number(m[2]);
  }
  return marginCell === null ? null : parsePercent(marginCell.replace(/^\s*\+/, ""));
}

function linkedOf(linkageCell: string | null, track: string): boolean | null {
  const t = norm(linkageCell ?? "");
  if (t === "כן") return true;
  if (t === "לא" || t.includes("לא צמוד") || t.includes("ללא")) return false;
  if (t.includes("צמוד") || t.includes("מדד")) return true;
  if (linkageCell !== null) return null;
  if (track.includes("לא צמוד")) return false;
  return track.includes("צמוד") ? true : null;
}

/** The loans page as a snapshot: one ScrapedLoan per track row, `schedule` empty (her schedule file stays the source, §7). */
export function parseLoanTables(tables: CellTables): TableParse<ScrapedLoan> {
  return parseTables(tables, {
    fields: LOAN_FIELDS,
    excluded: LOAN_EXCLUDED,
    required: (c) => c.loanNumber !== undefined && (c.principalBalance !== undefined || c.nextPaymentAmount !== undefined || c.originalAmount !== undefined),
    max: MAX_LOANS,
  }, (cell) => {
    const loanNumber = lastFour(cell("loanNumber") ?? "");
    if (!loanNumber) return null;
    const originalAmount = abs(parseAmount(cell("originalAmount") ?? ""));
    const principalBalance = abs(parseAmount(cell("principalBalance") ?? ""));
    const indexedBalance = abs(parseAmount(cell("indexedBalance") ?? ""));
    const nextPaymentAmount = abs(parseAmount(cell("nextPaymentAmount") ?? ""));
    if ([originalAmount, principalBalance, indexedBalance, nextPaymentAmount].every((value) => value === null)) return null;
    const track = norm(cell("track") ?? "");
    const rateCell = cell("annualInterestRate");
    const typeTexts = [cell("interestKind") ?? "", track, rateCell ?? ""].map(norm);
    const made = parseCount(cell("paymentsMade") ?? "");
    const left = parseCount(cell("paymentsLeft") ?? "");
    const total = parseCount(cell("paymentsTotal") ?? "") ?? (made !== null && left !== null ? made + left : null);
    return {
      loanNumber,
      trackNumber: lastFour(cell("trackNumber") ?? ""),
      name: plainText(cell("name") ?? "") ?? plainText(cell("track") ?? ""),
      asOf: null,
      originalAmount,
      principalBalance,
      indexedBalance,
      interestType: typeTexts.map(interestTypeOf).find((type) => type !== null) ?? null,
      annualInterestRate: rateCell === null ? null : parsePercent(rateCell),
      primeMargin: marginOf(cell("primeMargin"), typeTexts),
      indexLinked: linkedOf(cell("linkage"), track),
      baseIndex: null,
      baseIndexMonth: null,
      paymentsMade: made ?? (total !== null && left !== null && total >= left ? total - left : null),
      paymentsTotal: total ? total : null,
      startDate: parseDate(cell("startDate") ?? ""),
      endDate: parseDate(cell("endDate") ?? ""),
      nextPaymentAmount,
      nextPaymentDate: parseDate(cell("nextPaymentDate") ?? ""),
      schedule: [],
    };
  });
}

type OrderField = "reference" | "payee" | "amount" | "lastChargeDate" | "dayOfMonth" | "kind" | "status";

// A beneficiary's account or bank column is never the payee's name, and the last charge's amount neither the
// order's amount nor its date.
const ORDER_EXCLUDED = ["מספר חשבון", "חשבון מוטב", "חשבון המוטב", "סניף", "קוד בנק", "מספר בנק", "בנק המוטב", "קוד מוסד", "סכום חיוב אחרון", "סכום החיוב האחרון",
  // A direct debit's ceiling is a limit she set, not what is charged.
  "מרבי", "תקרה", "תקרת", "מקסימלי", "מקסימום", "גבול"];

const ORDER_FIELDS: readonly FieldSpec<OrderField>[] = [
  ["reference", ["אסמכתא", "מספר הרשאה", "מספר ההרשאה", "מס הרשאה", "מספר הוראה", "מספר ההוראה", "מס הוראה"]],
  ["payee", ["שם המוטב", "מוטב", "לטובת", "שם החברה", "שם המוסד", "שם הגוף", "גוף מחייב", "המוסד המחייב"]],
  ["amount", ["סכום קבוע", "סכום ההוראה", "סכום החיוב", "סכום"]],
  ["lastChargeDate", ["תאריך חיוב אחרון", "מועד חיוב אחרון", "חיוב אחרון"]],
  ["dayOfMonth", ["יום חיוב", "יום החיוב", "יום בחודש", "מועד חיוב", "מועד החיוב"]],
  ["kind", ["סוג הוראה", "סוג ההוראה", "סוג הרשאה", "סוג ההרשאה", "סוג"]],
  ["status", ["סטטוס", "מצב"]],
];

const INACTIVE = ["לא פעיל", "מבוטל", "בוטל", "מוקפא", "הוקפא", "הסתיים", "לא בתוקף", "מושהה"];

function dayOf(text: string): number | null {
  const date = parseDate(text);
  const day = date ? Number(date.slice(8)) : Number(/^(\d{1,2})(?![\d./-])/.exec(norm(text))?.[1] ?? Number.NaN);
  return Number.isInteger(day) && day >= 1 && day <= 31 ? day : null;
}

function kindOf(text: string): ScrapedStandingOrder["kind"] {
  if (text.includes("קבע")) return "standing_order";
  return text.includes("הרשא") || text.includes("חיוב") ? "direct_debit" : null;
}

function statusOf(text: string): ScrapedStandingOrder["status"] {
  if (INACTIVE.some((word) => text.includes(word))) return "inactive";
  return text.includes("פעיל") || text.includes("בתוקף") ? "active" : null;
}

/** The standing-orders page: one row per order or direct-debit authorisation the bank lists. */
export function parseStandingOrderTables(tables: CellTables): TableParse<ScrapedStandingOrder> {
  return parseTables(tables, {
    fields: ORDER_FIELDS,
    excluded: ORDER_EXCLUDED,
    required: (c) => c.payee !== undefined && (c.amount !== undefined || c.reference !== undefined || c.dayOfMonth !== undefined),
    max: MAX_STANDING_ORDERS,
  }, (cell) => {
    const payee = plainText(cell("payee") ?? "");
    if (!payee) return null;
    return {
      payee,
      // A 0 on the page is "no fixed amount", not a free order.
      amount: abs(parseAmount(cell("amount") ?? "")) || null,
      dayOfMonth: dayOf(cell("dayOfMonth") ?? ""),
      kind: kindOf(norm(cell("kind") ?? "")),
      status: statusOf(norm(cell("status") ?? "")),
      reference: lastFour(cell("reference") ?? ""),
      lastChargeDate: parseDate(cell("lastChargeDate") ?? ""),
    };
  });
}
