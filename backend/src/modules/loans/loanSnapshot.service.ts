import { z } from "zod";
import type { Loan } from "../../../generated/prisma/client";
import { prisma } from "../../config/database";
import { decimalOrNull, round2 } from "../../utils/money.utils";
import { loanDays, type LoanDay } from "../bank/statementCommitments.detector";
import { accountEvidence, SAME_PAYMENT_RATIO } from "../bank/statementCommitments.service";
import type { ScrapedLoan } from "../../types/connections.types";
import type {
  LoanDetailsPreview, LoanDetailsPreviewItem, LoanMatchReason, LoanSnapshotRecord, SnapshotLoan, SnapshotLoanField, SnapshotLoanValue,
} from "../../types/siteSnapshot.types";

// The banker's rule (2026-11-14) for what a bank-site loan snapshot may write; see CLAUDE.md §5, §7 A2.
const FORMAT = "bank-site-loans-v1";
const STALE_SCHEDULE_RATIO = 0.01;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const amount = z.number().finite().nullable();
// The worker's own limits (scraperIsolation parseExtras), so whatever it passed is stored as it came.
const day = z.string().max(40).nullable();
const snapshotLoanSchema = z.strictObject({
  loanNumber: z.string().max(40), trackNumber: z.string().max(40).nullable(), name: z.string().max(200).nullable(), asOf: day,
  originalAmount: amount, principalBalance: amount, indexedBalance: amount,
  interestType: z.enum(["fixed", "prime", "variable"]).nullable(), annualInterestRate: amount, primeMargin: amount,
  indexLinked: z.boolean().nullable(), baseIndex: amount, baseIndexMonth: z.string().max(10).nullable(),
  paymentsMade: amount, paymentsTotal: amount, startDate: day, endDate: day,
  nextPaymentAmount: amount, nextPaymentDate: day,
});
const fileSchema = z.strictObject({ format: z.literal(FORMAT), loans: z.array(snapshotLoanSchema).min(1).max(100) });

/** "0108" and "108" are one loan: digits only, the last four, no leading zeros. */
export function loanDigits(value: string | null | undefined): string | null {
  const digits = (value ?? "").replace(/\D/g, "").slice(-4).replace(/^0+/, "");
  return digits || null;
}

function snapshotOf(loan: ScrapedLoan): SnapshotLoan {
  const { schedule: _schedule, ...rest } = loan;
  return snapshotLoanSchema.parse(rest);
}

/** Identical reads give identical bytes, so a re-sync lands on the same import session (its file hash). */
export function loanDetailsFile(loans: ScrapedLoan[]): Buffer {
  const sorted = loans.map(snapshotOf).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return Buffer.from(JSON.stringify({ format: FORMAT, loans: sorted }), "utf8");
}

export function readLoanDetailsFile(buffer: Buffer): SnapshotLoan[] | null {
  try {
    const parsed = fileSchema.safeParse(JSON.parse(buffer.toString("utf8")));
    return parsed.success ? parsed.data.loans : null;
  } catch {
    return null;
  }
}

const dayOf = (value: string | null) => (value && DAY.test(value) && !Number.isNaN(Date.parse(value)) ? value : null);
const count = (value: number | null, min: number) => (value !== null && Number.isInteger(value) && value >= min && value <= 1200 ? value : null);
const balance = (value: number | null) => (value !== null && value >= 0 ? round2(value) : null);

/**
 * The figures a snapshot can stand behind. An early-repayment figure is never mapped here by the worker;
 * a CPI-linked loan's balance is the bank's revalued one or nothing; a prime margin alone is not a rate.
 */
export function siteFigures(s: SnapshotLoan): Partial<Record<SnapshotLoanField, SnapshotLoanValue | null>> {
  const nominal = balance(s.principalBalance);
  const indexed = balance(s.indexedBalance);
  const currentBalance = s.indexLinked === true ? indexed
    : s.indexLinked === false ? nominal
    : indexed !== null && nominal !== null && indexed !== nominal ? null : nominal;
  const rate = s.annualInterestRate !== null && s.annualInterestRate >= 0 && s.annualInterestRate <= 100 ? round2(s.annualInterestRate) : null;
  const totalPayments = count(s.paymentsTotal, 1);
  const made = count(s.paymentsMade, 0);
  return {
    currentBalance, annualInterestRate: rate, endDate: dayOf(s.endDate), totalPayments,
    paymentsMade: made !== null && (totalPayments === null || made <= totalPayments) ? made : null,
    trackNumber: s.trackNumber && loanDigits(s.trackNumber) ? s.trackNumber.replace(/\D/g, "").slice(-4) : null,
    isIndexLinked: s.indexLinked === true ? true : null,
  };
}

const withinPayment = (site: number, ours: number) => Math.abs(site - ours) <= ours * SAME_PAYMENT_RATIO;

interface MatchResult { loan: Loan | null; reason: LoanMatchReason; checkingLines: number; }

/** Never by amount alone: the loan number decides, the track and the monthly amount only confirm. */
export function matchSnapshotLoans(snapshots: SnapshotLoan[], loans: Loan[], checkingDays: LoanDay[]): MatchResult[] {
  const open = loans.filter((l) => l.status !== "finished");
  const tracksOf = (number: string) => snapshots.filter((s) => loanDigits(s.loanNumber) === number).length;
  const results = snapshots.map((s): MatchResult => {
    const number = loanDigits(s.loanNumber);
    if (!number) return { loan: null, reason: "ambiguous", checkingLines: 0 };
    const checkingLines = checkingDays.filter((d) => loanDigits(d.loanNumber) === number).length;
    const track = loanDigits(s.trackNumber);
    const byNumber = open.filter((l) => loanDigits(l.loanNumber) === number);
    const candidates = byNumber.filter((l) => !track || !loanDigits(l.trackNumber) || loanDigits(l.trackNumber) === track);
    if (!candidates.length) return { loan: null, reason: "no_loan", checkingLines };
    const site = s.nextPaymentAmount;
    const fitting = site === null ? candidates : candidates.filter((l) => withinPayment(site, Number(l.monthlyPayment)));
    if (fitting.length !== 1) return { loan: null, reason: "ambiguous", checkingLines };
    const loan = fitting[0];
    // A statement loan holds the whole day's debit: with several tracks on its number, which one it is is a guess.
    if (loan.scheduleSource === "statement" && (tracksOf(number) > 1 || site === null)) return { loan: null, reason: "ambiguous", checkingLines };
    return { loan, reason: "matched", checkingLines };
  });
  const picks = results.map((r) => r.loan?.id);
  return results.map((r) => (r.loan && picks.filter((id) => id === r.loan!.id).length > 1 ? { ...r, loan: null, reason: "ambiguous" } : r));
}

function currentValue(loan: Loan, field: SnapshotLoanField): SnapshotLoanValue | null {
  switch (field) {
    case "currentBalance": return decimalOrNull(loan.currentBalance);
    case "annualInterestRate": return decimalOrNull(loan.annualInterestRate);
    case "endDate": return loan.endDate ? loan.endDate.toISOString().slice(0, 10) : null;
    case "totalPayments": return loan.totalPayments;
    case "paymentsMade": return loan.paymentsMade;
    case "trackNumber": return loan.trackNumber;
    case "isIndexLinked": return loan.isIndexLinked;
  }
}

function same(field: SnapshotLoanField, a: SnapshotLoanValue, b: SnapshotLoanValue): boolean {
  if (field === "trackNumber") return loanDigits(String(a)) === loanDigits(String(b));
  return typeof a === "number" && typeof b === "number" ? round2(a) === round2(b) : a === b;
}

const FIELD_LABELS: Record<SnapshotLoanField, string> = {
  currentBalance: "יתרה", annualInterestRate: "ריבית שנתית", endDate: "תאריך סיום", totalPayments: "מספר תשלומים",
  paymentsMade: "תשלומים ששולמו", trackNumber: "מסלול", isIndexLinked: "הצמדה למדד",
};
const shown = (value: SnapshotLoanValue) => (typeof value === "boolean" ? (value ? "כן" : "לא") : String(value));

interface FillPlan { fills: Array<{ field: SnapshotLoanField; value: SnapshotLoanValue }>; notes: string[]; owned: Partial<Record<SnapshotLoanField, SnapshotLoanValue>>; }

/**
 * Only an empty field, or one an earlier and older snapshot wrote, is filled. A bank file or her own
 * figure is never replaced — at most shown beside it. monthlyPayment and startDate are never touched.
 */
export function planLoanFill(s: SnapshotLoan, loan: Loan, asOf: string, previous: LoanSnapshotRecord | null): FillPlan {
  const plan: FillPlan = { fills: [], notes: [], owned: {} };
  if (loan.status === "finished") return plan;
  const site = siteFigures(s);
  if (loan.scheduleSource === "bank_file") {
    const ours = decimalOrNull(loan.currentBalance);
    if (ours !== null && s.principalBalance !== null && Math.abs(s.principalBalance - ours) > ours * STALE_SCHEDULE_RATIO) plan.notes.push(`ייתכן שהלוח ישן: הבנק מציג יתרה ${round2(s.principalBalance)}`);
    return plan;
  }
  const snapshotAsOf = loan.siteSnapshotAsOf?.toISOString().slice(0, 10) ?? null;
  const record = previous && snapshotAsOf === previous.asOf ? previous : null;
  const newer = snapshotAsOf !== null && asOf > snapshotAsOf;
  const fields: SnapshotLoanField[] = ["currentBalance", "annualInterestRate", "endDate", "totalPayments", "paymentsMade", "trackNumber",
    ...(loan.scheduleSource === "statement" ? ["isIndexLinked" as const] : [])];
  for (const field of fields) {
    const value = site[field] ?? null;
    const current = currentValue(loan, field);
    const recorded = record?.fields[field];
    const owned = recorded !== undefined && current !== null && same(field, current, recorded);
    if (owned) plan.owned[field] = recorded;
    if (value === null) continue;
    const empty = field === "isIndexLinked" ? current === false : current === null;
    if (empty || (owned && newer && !same(field, current!, value))) {
      plan.fills.push({ field, value });
      plan.owned[field] = value;
    } else if (!same(field, current!, value)) {
      plan.notes.push(`${FIELD_LABELS[field]}: הבנק מציג ${shown(value)}`);
    }
  }
  return plan;
}

function missingOf(s: SnapshotLoan): string[] {
  const always = ["principalBalance", "annualInterestRate", "nextPaymentAmount", "nextPaymentDate", "paymentsMade", "paymentsTotal", "endDate", "interestType", "indexLinked"] as const;
  return [...always.filter((field) => s[field] === null), ...(s.indexLinked === true && s.indexedBalance === null ? ["indexedBalance"] : [])];
}

async function latestRecords(userId: number): Promise<Map<number, LoanSnapshotRecord>> {
  const sessions = await prisma.importSession.findMany({ where: { userId, kind: "loan_details", status: { in: ["review", "completed"] } }, orderBy: { updatedAt: "desc" }, select: { result: true } });
  const latest = new Map<number, LoanSnapshotRecord>();
  for (const session of sessions) {
    const records = (session.result as { details?: { records?: LoanSnapshotRecord[] } } | null)?.details?.records ?? [];
    for (const record of records) if (!latest.has(record.loanId)) latest.set(record.loanId, record);
  }
  return latest;
}

async function checkingLoanDays(userId: number, accountId: number | undefined): Promise<LoanDay[]> {
  if (!accountId) return [];
  const evidence = await accountEvidence(userId, accountId, [], []);
  return evidence ? loanDays(evidence.debits) : [];
}

interface Evaluated { preview: LoanDetailsPreview; plans: Array<{ loan: Loan; plan: FillPlan; asOf: string }>; }

async function evaluate(userId: number, snapshots: SnapshotLoan[], syncDay: string, accountId?: number): Promise<Evaluated> {
  const [loans, records, days] = await Promise.all([
    prisma.loan.findMany({ where: { userId }, orderBy: { id: "asc" } }), latestRecords(userId), checkingLoanDays(userId, accountId),
  ]);
  const matches = matchSnapshotLoans(snapshots, loans, days);
  const keys = new Map<string, number>();
  const plans: Evaluated["plans"] = [];
  const items = snapshots.map((s, i): LoanDetailsPreviewItem => {
    const base = `loan:${loanDigits(s.loanNumber) ?? "-"}:${loanDigits(s.trackNumber) ?? "-"}`;
    const seen = keys.get(base) ?? 0;
    keys.set(base, seen + 1);
    const asOf = dayOf(s.asOf) ?? syncDay;
    const { loan, reason, checkingLines } = matches[i];
    const plan = loan ? planLoanFill(s, loan, asOf, records.get(loan.id) ?? null) : { fills: [], notes: [], owned: {} };
    if (loan) plans.push({ loan, plan, asOf });
    return {
      key: seen ? `${base}:${seen + 1}` : base, loanNumberLast4: s.loanNumber.replace(/\D/g, "").slice(-4), trackNumber: s.trackNumber, name: s.name,
      principalBalance: s.principalBalance, annualInterestRate: s.annualInterestRate, nextPaymentAmount: s.nextPaymentAmount, nextPaymentDate: dayOf(s.nextPaymentDate),
      paymentsMade: s.paymentsMade, paymentsTotal: s.paymentsTotal, endDate: dayOf(s.endDate), interestType: s.interestType, indexLinked: s.indexLinked,
      indexedBalance: s.indexedBalance, asOf, missing: missingOf(s),
      match: { loanId: loan?.id ?? null, loanName: loan?.loanName ?? null, checkingLines, reason }, fills: plan.fills, notes: plan.notes,
    };
  });
  return { preview: { kind: "loan_details", loans: items }, plans };
}

const asDate = (day: string) => new Date(`${day}T00:00:00Z`);

export const loanSnapshotService = {
  preview: (userId: number, snapshots: SnapshotLoan[], syncDay: string, accountId?: number) => evaluate(userId, snapshots, syncDay, accountId).then((e) => e.preview),

  /** Her approval: re-matched against the loans as they are now, then only the planned fills are written. */
  async apply(userId: number, snapshots: SnapshotLoan[], syncDay: string, accountId?: number) {
    const { preview, plans } = await evaluate(userId, snapshots, syncDay, accountId);
    const records: LoanSnapshotRecord[] = [];
    for (const { loan, plan, asOf } of plans) {
      if (!plan.fills.length) continue;
      const data = Object.fromEntries(plan.fills.map(({ field, value }) => [field, field === "endDate" ? asDate(String(value)) : value]));
      await prisma.loan.update({ where: { id: loan.id }, data: { ...data, siteSnapshotAsOf: asDate(asOf) } });
      records.push({ loanId: loan.id, asOf, fields: plan.owned });
    }
    console.log(`[פרטי הלוואות מאתר הבנק] ${preview.loans.length} מסלולים: ${preview.loans.filter((l) => l.match.reason === "matched").length} הותאמו, ${records.length} הלוואות עודכנו`);
    return { preview, records, updated: records.length };
  },
};
