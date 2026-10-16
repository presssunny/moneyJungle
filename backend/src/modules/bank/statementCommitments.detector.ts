import { classifyBankLine } from "./bankParser.service";
import { round2 } from "../../utils/money.utils";
import type { DetectedCommitment, StatementDebit } from "../../types/commitments.types";

const DAY_MS = 24 * 60 * 60 * 1000;
const DAY_OF_MONTH_TOLERANCE = 4;
const LOAN_PAYMENT_KINDS = new Set(["loan_principal", "loan_interest", "loan_mixed"]);
// Interest lines print the rate (01040 = 10.40%), not the loan — only these name it.
const LOAN_NUMBER_KINDS = new Set(["loan_principal", "loan_mixed"]);
const PAYOFF_FEE_WINDOW_DAYS = 3;
// Two tracks of one loan can fall four days apart (15th / 19th) — tighter than a payee's drift.
const LOAN_DAY_TOLERANCE = 2;
const AMOUNT_TOLERANCE = 1.15;

// Variable cash withdrawals repeat often but are not obligations.
const NOT_A_COMMITMENT = /כספומט|כספונט|סניפומט|בנקט|משיכת\s*מזומן/;
// The text names no payee, so the amount is what identifies the obligation.
const PAYEE_LESS = /שיק|העברה/;

interface Occurrence {
  month: string;
  date: Date;
  amount: number;
}

function monthKey(date: Date): string {
  return date.toISOString().slice(0, 7);
}

function monthIndex(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return y * 12 + m;
}

/** Cheque and reference numbers change every month; the payee wording does not. */
export function normalizePayee(description: string): string {
  return description.replace(/[\d\s.,'"״׳`\-–־/\\()[\]:]+/g, "");
}

function displayName(description: string): string {
  return description.replace(/\d{3,}/g, "").replace(/\s+/g, " ").trim() || description.trim();
}

function nextMonthly(last: Date, after: Date): Date {
  const day = last.getUTCDate();
  let year = after.getUTCFullYear();
  let month = after.getUTCMonth();
  for (;;) {
    const dim = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const candidate = new Date(Date.UTC(year, month, Math.min(day, dim)));
    if (candidate > after) return candidate;
    month += 1;
    if (month > 11) { month = 0; year += 1; }
  }
}

function dayDistance(a: number, b: number): number {
  const d = Math.abs(a - b);
  return Math.min(d, 31 - d);
}

/**
 * The most recent stretch of months whose amounts agree. A repriced charge
 * (487 → 129) restarts the run, so the forecast uses what is paid now.
 * One missing month inside a run is tolerated.
 */
function latestRun(occurrences: Occurrence[]): Occurrence[] {
  const run: Occurrence[] = [];
  for (let i = occurrences.length - 1; i >= 0; i--) {
    const occ = occurrences[i];
    if (run.length) {
      const prev = run[0];
      const amounts = [...run.map((r) => r.amount), occ.amount];
      if (monthIndex(prev.month) - monthIndex(occ.month) > 2) break;
      if (Math.max(...amounts) / Math.min(...amounts) > AMOUNT_TOLERANCE) break;
      if (dayDistance(prev.date.getUTCDate(), occ.date.getUTCDate()) > DAY_OF_MONTH_TOLERANCE) break;
    }
    run.unshift(occ);
  }
  return run;
}

/**
 * One occurrence per month. When a month has several debits to the same payee
 * (a one-off cheque beside the monthly one), the one closest to the typical
 * single-debit amount is the fixed payment.
 */
function monthlyOccurrences(debits: StatementDebit[]): Occurrence[] | null {
  const byMonth = new Map<string, StatementDebit[]>();
  for (const d of debits) {
    const key = monthKey(d.date);
    byMonth.set(key, [...(byMonth.get(key) ?? []), d]);
  }
  if (debits.length / byMonth.size > 2) return null;
  const singles = [...byMonth.values()].filter((rows) => rows.length === 1).map((rows) => rows[0].amount).sort((a, b) => a - b);
  if (!singles.length) return null;
  const typical = singles[Math.floor(singles.length / 2)];
  return [...byMonth]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, rows]) => {
      const pick = rows.reduce((best, r) => (Math.abs(r.amount - typical) < Math.abs(best.amount - typical) ? r : best));
      return { month, date: pick.date, amount: pick.amount };
    });
}

/** The next expected debit already falls inside the statement — the series stopped. */
function stopped(last: Date, statementEnd: Date): boolean {
  return nextMonthly(last, last).getTime() + DAY_OF_MONTH_TOLERANCE * DAY_MS <= statementEnd.getTime();
}

function detectRecurring(debits: StatementDebit[], statementEnd: Date, forecastFrom: Date): DetectedCommitment[] {
  const groups = new Map<string, StatementDebit[]>();
  for (const d of debits) {
    if (d.lineKind !== "standard" || d.amount <= 0) continue;
    if (classifyBankLine(d.description, "withdrawal").lineKind !== "standard") continue;
    if (NOT_A_COMMITMENT.test(d.description)) continue;
    const payee = normalizePayee(d.description);
    if (!payee) continue;
    const key = PAYEE_LESS.test(d.description) ? `${payee}:${Math.round(d.amount)}` : payee;
    groups.set(key, [...(groups.get(key) ?? []), d]);
  }

  const found: DetectedCommitment[] = [];
  for (const [payee, rows] of groups) {
    const occurrences = monthlyOccurrences(rows);
    if (!occurrences || occurrences.length < 2) continue;
    const run = latestRun(occurrences);
    const last = run[run.length - 1];
    if (stopped(last.date, statementEnd)) continue;
    // Two months is enough only when the payee itself has a longer monthly history
    // (a repriced charge); otherwise a 3-month statement must show it three times.
    if (run.length < 3 && !(run.length === 2 && occurrences.length >= 3)) continue;
    const latest = rows.find((r) => r.date.getTime() === last.date.getTime())!;
    found.push({
      key: `recurring:${payee}`,
      kind: "recurring",
      name: displayName(latest.description),
      amount: round2(last.amount),
      dayOfMonth: last.date.getUTCDate(),
      months: run.length,
      lastDate: last.date.toISOString().slice(0, 10),
      nextDate: nextMonthly(last.date, forecastFrom).toISOString().slice(0, 10),
      loanNumber: null,
    });
  }
  return found;
}

interface LoanDay {
  date: Date;
  total: number;
  loanNumber: string | null;
}

/**
 * One loan per bank loan number and payment day, priced at the latest month's
 * full debit (principal + interest, gross). Tracks paid on the same day can't
 * be told apart from the statement, so they stay one entry until a schedule
 * file replaces it. Payoff days are not instalments.
 */
function detectLoans(debits: StatementDebit[], statementEnd: Date, forecastFrom: Date): DetectedCommitment[] {
  const feeTimes = debits.filter((d) => d.lineKind === "loan_fee").map((d) => d.date.getTime());
  const byDate = new Map<string, StatementDebit[]>();
  for (const d of debits) {
    if (!LOAN_PAYMENT_KINDS.has(d.lineKind)) continue;
    const key = d.date.toISOString().slice(0, 10);
    byDate.set(key, [...(byDate.get(key) ?? []), d]);
  }

  const series = new Map<string, LoanDay[]>();
  for (const rows of byDate.values()) {
    const date = rows[0].date;
    if (feeTimes.some((t) => Math.abs(t - date.getTime()) <= PAYOFF_FEE_WINDOW_DAYS * DAY_MS)) continue;
    const numbers = new Set(rows.filter((r) => LOAN_NUMBER_KINDS.has(r.lineKind) && r.loanRef).map((r) => r.loanRef!));
    const loanNumber = numbers.size === 1 ? [...numbers][0] : null;
    const day: LoanDay = { date, total: round2(rows.reduce((s, r) => s + r.amount, 0)), loanNumber };
    const existing = [...series.entries()].find(
      ([, days]) => days[0].loanNumber === loanNumber && dayDistance(days[0].date.getUTCDate(), date.getUTCDate()) <= LOAN_DAY_TOLERANCE
    );
    if (existing) existing[1].push(day);
    else series.set(`${loanNumber ?? "unnumbered"}:${date.getUTCDate()}`, [day]);
  }

  const found: DetectedCommitment[] = [];
  for (const [id, days] of series) {
    days.sort((a, b) => a.date.getTime() - b.date.getTime());
    const months = new Set(days.map((d) => monthKey(d.date))).size;
    const last = days[days.length - 1];
    if (months < 2 || stopped(last.date, statementEnd)) continue;
    found.push({
      key: `loan:${id}`,
      kind: "loan",
      name: last.loanNumber ? `הלוואה ${last.loanNumber}` : "החזר הלוואה מהחשבון",
      amount: last.total,
      dayOfMonth: last.date.getUTCDate(),
      months,
      lastDate: last.date.toISOString().slice(0, 10),
      nextDate: nextMonthly(last.date, forecastFrom).toISOString().slice(0, 10),
      loanNumber: last.loanNumber,
    });
  }
  return found;
}

/**
 * Fixed monthly debits a bank statement proves: obligations the household pays
 * every month whether or not anyone wrote them down. Card settlements are left
 * out — the card's own statement itemizes them (CLAUDE.md §4).
 */
export function detectStatementCommitments(debits: StatementDebit[], statementEnd: Date, today = statementEnd): DetectedCommitment[] {
  // An old statement must not leave past months open: the first payment offered
  // is the next one from today, the months in between arrive with their statements.
  const forecastFrom = today > statementEnd ? today : statementEnd;
  return [...detectLoans(debits, statementEnd, forecastFrom), ...detectRecurring(debits, statementEnd, forecastFrom)].sort(
    (a, b) => (a.kind === b.kind ? b.amount - a.amount : a.kind === "loan" ? -1 : 1)
  );
}
