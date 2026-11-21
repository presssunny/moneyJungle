import { Prisma } from "../../../generated/prisma/client";
import { prisma } from "../../config/database";
import { decimalToNumber, round2 } from "../../utils/money.utils";
import { businessDate } from "../../utils/date.utils";
import { isTrackLeftover } from "../loans/loanCalculator.service";
import type { ParsedBankRow } from "./bankParser.service";
import { detectStatementCommitments, samePayee } from "./statementCommitments.detector";
import type { DebitEvidence, DetectedCommitment, StatementDebit } from "../../types/commitments.types";

const SAME_PAYMENT_DAYS = 3;
export const SAME_PAYMENT_RATIO = 0.05;

/**
 * Stored rows plus the rows of a statement not yet imported. Statements overlap,
 * so an identical line counts as many times as the busier source has it.
 */
function mergeRows(stored: StatementDebit[], incoming: StatementDebit[]): StatementDebit[] {
  const id = (d: StatementDebit) => `${d.date.toISOString().slice(0, 10)}|${d.amount}|${d.description}`;
  const storedCount = new Map<string, number>();
  for (const d of stored) storedCount.set(id(d), (storedCount.get(id(d)) ?? 0) + 1);
  const extra: StatementDebit[] = [];
  for (const d of incoming) {
    const left = storedCount.get(id(d)) ?? 0;
    if (left > 0) storedCount.set(id(d), left - 1);
    else extra.push(d);
  }
  return [...stored, ...extra];
}

export function sameDay(a: number, b: number): boolean {
  const d = Math.abs(a - b);
  return Math.min(d, 31 - d) <= SAME_PAYMENT_DAYS;
}

/** What the household already tracks: by key, or by amount + day + payee. */
export async function untracked(userId: number, found: DetectedCommitment[]): Promise<DetectedCommitment[]> {
  const [dismissed, recurrings, subscriptions, loans] = await Promise.all([
    prisma.dismissedCommitment.findMany({ where: { userId }, select: { key: true } }),
    prisma.recurringPayment.findMany({ where: { userId }, select: { detectedKey: true, name: true, amount: true, nextPaymentDate: true } }),
    prisma.subscription.findMany({ where: { userId, status: "active" }, select: { name: true, amount: true, billingDate: true } }),
    prisma.loan.findMany({ where: { userId }, select: { detectedKey: true, loanNumber: true, status: true, monthlyPayment: true, startDate: true } }),
  ]);
  const known = new Set([...dismissed.map((d) => d.key), ...recurrings.map((r) => r.detectedKey), ...loans.map((l) => l.detectedKey)]);
  const planned = [
    ...recurrings.map((r) => ({ name: r.name, amount: decimalToNumber(r.amount), day: r.nextPaymentDate.getUTCDate() })),
    ...subscriptions.map((s) => ({ name: s.name, amount: decimalToNumber(s.amount), day: s.billingDate.getUTCDate() })),
  ];
  const activeLoans = loans
    .filter((l) => l.status !== "finished")
    .map((l) => ({ amount: decimalToNumber(l.monthlyPayment), day: l.startDate.getUTCDate() }));
  const matches = (list: Array<{ amount: number; day: number }>, c: DetectedCommitment) =>
    list.some((p) => sameDay(p.day, c.dayOfMonth) && Math.abs(p.amount - c.amount) <= c.amount * SAME_PAYMENT_RATIO);
  return found.filter((c) => {
    if (known.has(c.key)) return false;
    // A loan number already on record is that loan, whichever track — its schedule owns the terms.
    if (c.kind === "loan") return !(c.loanNumber && loans.some((l) => l.loanNumber === c.loanNumber)) && !matches(activeLoans, c);
    // Amount and day alone would let two different payees of the same sum swallow each other.
    return !matches(planned.filter((p) => samePayee(p.name, c.name)), c);
  });
}

/** The one way a detected recurring debit becomes a RecurringPayment; `extra` may only add labels. */
export function createDetectedRecurring(userId: number, c: DetectedCommitment, extra: Pick<Prisma.RecurringPaymentUncheckedCreateInput, "verifiedAt" | "verifiedSource" | "debitKind" | "bankStatus" | "bankReference"> = {}) {
  return prisma.recurringPayment.create({
    data: { userId, name: c.name, amount: c.amount, frequency: "monthly", nextPaymentDate: new Date(c.nextDate), detectedKey: c.key, detectedThrough: new Date(c.lastDate), ...extra },
  });
}

function toDebit(row: { transactionDate: Date; description: string | null; amount: Prisma.Decimal; lineKind: string; loanRef: string | null }): StatementDebit {
  return { date: row.transactionDate, description: row.description ?? "", amount: decimalToNumber(row.amount), lineKind: row.lineKind, loanRef: row.loanRef };
}

/**
 * The stored debits plus incoming ones. `newerOnly` keeps only incoming rows after the last stored
 * day: a site's wording differs from a file's, so the exact-text merge would count such a row twice.
 */
export async function accountEvidence(
  userId: number, accountId: number, incoming: StatementDebit[], incomingDays: Date[], { newerOnly = false } = {}
): Promise<DebitEvidence | null> {
  const stored = await prisma.bankTransaction.findMany({
    where: { userId, bankAccountId: accountId },
    select: { transactionDate: true, description: true, amount: true, lineKind: true, loanRef: true, type: true },
  });
  const storedDays = stored.map((r) => r.transactionDate.getTime());
  const storedEnd = storedDays.length ? Math.max(...storedDays) : -Infinity;
  const fresh = (date: Date) => !newerOnly || date.getTime() > storedEnd;
  const debits = mergeRows(stored.filter((r) => r.type === "withdrawal").map(toDebit), incoming.filter((d) => fresh(d.date)));
  const days = [...storedDays, ...incomingDays.filter(fresh).map((d) => d.getTime())];
  if (!days.length) return null;
  return { debits, first: new Date(Math.min(...days)), last: new Date(Math.max(...days)) };
}

export const statementCommitmentsService = {
  /** Every commitment the account's statements prove, tracked or not. */
  async found(userId: number, accountId: number, incoming: ParsedBankRow[] = []): Promise<DetectedCommitment[]> {
    const evidence = await accountEvidence(
      userId, accountId,
      incoming.filter((r) => r.type === "withdrawal").map((r) => ({ date: r.date, description: r.description, amount: r.amount, lineKind: r.lineKind, loanRef: r.loanRef })),
      incoming.map((r) => r.date)
    );
    if (!evidence) return [];
    return detectStatementCommitments(evidence.debits, evidence.last, new Date(businessDate()));
  },

  /** Commitments the account's statements prove and the household does not track yet. */
  async detect(userId: number, accountId: number, incoming: ParsedBankRow[] = []): Promise<DetectedCommitment[]> {
    return untracked(userId, await this.found(userId, accountId, incoming));
  },

  /**
   * A newer statement is fresher evidence for what was already added from an
   * older one: the amount it charges now and the next date it is due. A
   * statement loan keeps only what its uploaded tracks' schedules don't cover.
   */
  async refresh(userId: number, found: DetectedCommitment[]) {
    for (const c of found) {
      const next = new Date(c.nextDate);
      const through = new Date(c.lastDate);
      const older = { OR: [{ detectedThrough: null }, { detectedThrough: { lt: through } }] };
      if (c.kind === "recurring") {
        await prisma.recurringPayment.updateMany({ where: { userId, detectedKey: c.key, ...older }, data: { amount: c.amount, nextPaymentDate: next, detectedThrough: through } });
        // A debit after the day the bank's page listed it as inactive outranks that page.
        await prisma.recurringPayment.updateMany({ where: { userId, detectedKey: c.key, bankStatus: "inactive", verifiedAt: { lt: through } }, data: { bankStatus: null } });
        continue;
      }
      const loan = await prisma.loan.findFirst({ where: { userId, detectedKey: c.key, scheduleSource: "statement", ...older } });
      if (!loan) continue;
      const tracks = c.loanNumber
        ? await prisma.loan.aggregate({ where: { userId, loanNumber: c.loanNumber, scheduleSource: "bank_file", status: { not: "finished" } }, _sum: { monthlyPayment: true } })
        : null;
      const remaining = round2(c.amount - decimalToNumber(tracks?._sum.monthlyPayment));
      if (isTrackLeftover(remaining, c.amount)) await prisma.loan.delete({ where: { id: loan.id } });
      else await prisma.loan.update({ where: { id: loan.id }, data: { monthlyPayment: remaining, startDate: next, detectedThrough: through } });
    }
  },

  /**
   * Add what she marked. What she left unmarked is not added and not dismissed — "not now",
   * offered again by the next statement (only deleting an added item dismisses it).
   */
  async apply(userId: number, accountId: number, choice: { accept: string[] } | "all", offeredKeys?: string[]) {
    // Only what the approval screen showed — a commitment the user never saw is never added.
    const offered = offeredKeys && new Set(offeredKeys);
    const all = await this.found(userId, accountId);
    await this.refresh(userId, all);
    const found = (await untracked(userId, all)).filter((c) => !offered || offered.has(c.key));
    const accept = choice === "all" ? null : new Set(choice.accept);
    const account = await prisma.bankAccount.findFirst({ where: { id: accountId, userId }, select: { bankName: true } });
    const added: DetectedCommitment[] = [];
    for (const c of found) {
      if (accept && !accept.has(c.key)) continue;
      if (c.kind === "loan") {
        await prisma.loan.create({
          data: {
            userId, loanName: c.name, loanType: "bank", lenderName: account?.bankName ?? null,
            // A statement shows only the debit; the rest stays unknown until a schedule arrives.
            originalAmount: null, currentBalance: null, annualInterestRate: null, originalAmountSource: "unknown", monthlyPayment: c.amount,
            // The first payment not yet on a statement — earlier ones are already counted from the bank rows.
            startDate: new Date(c.nextDate), loanNumber: c.loanNumber, scheduleSource: "statement", detectedKey: c.key, detectedThrough: new Date(c.lastDate),
          },
        });
      } else {
        await createDetectedRecurring(userId, c);
      }
      added.push(c);
    }
    if (added.length) console.log(`[קליטת דוח בנק] נוספו ${added.length} התחייבויות קבועות שזוהו בדוח`);
    return added;
  },

  async dismiss(userId: number, key: string | null) {
    if (!key) return;
    await prisma.dismissedCommitment.upsert({ where: { userId_key: { userId, key } }, create: { userId, key }, update: {} });
  },
};
