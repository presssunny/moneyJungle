import { prisma } from "../../config/database";
import { buildUpcoming } from "../dashboard/cashflow.service";
import { businessDate, fingerprint, json } from "./journey.utils";
import { creditCardRefOf } from "../bank/bankParser.service";
import { CHARGE_MATCH_DAYS, ISSUER_ONLY_MATCH_DAYS } from "../bank/creditCoverage.service";
import type { Commitment } from "../../types/journey.types";
export type { Commitment } from "../../types/journey.types";
const DAY_MS = 24 * 60 * 60 * 1000;

// Before ever asking the user to resolve an overdue card bill, check whether
// the bank side already proves it was paid — reusing the same reconciliation
// signal (BankTransaction.resolution === "credit_card_settled") bank import
// already computed, never inferring "paid" from the date alone. A match is
// only applied when it is unambiguous; everything else is left for the user.
async function autoVerifyCardBills(userId: number, today: string, bills: Map<string, { key: string; date: string; name: string; amount: number; kind: string; to: string; cardId: number | null; cardLastFour: string | null }>, decisions: Array<{ eventKey: string; decision: string; bankTransactionId: number | null }>) {
  const undecided = [...bills.values()].filter(b => b.cardId !== null && !decisions.some(d => d.eventKey === b.key)).sort((a, b) => a.date.localeCompare(b.date));
  if (!undecided.length) return [] as Awaited<ReturnType<typeof prisma.commitmentDecision.create>>[];
  const alreadyLinked = new Set(decisions.filter(d => d.decision === "paid" && d.bankTransactionId !== null).map(d => d.bankTransactionId!));
  const settled = await prisma.bankTransaction.findMany({ where: { userId, resolution: "credit_card_settled", type: { not: "deposit" }, transactionDate: { lte: new Date(today) } }, orderBy: { transactionDate: "asc" } });
  const claimed = new Set<number>();
  const created: Awaited<ReturnType<typeof prisma.commitmentDecision.create>>[] = [];
  for (const bill of undecided) {
    const cents = Math.round(bill.amount * 100);
    const billTime = new Date(bill.date).getTime();
    const candidates = settled.filter(bt => {
      if (claimed.has(bt.id) || alreadyLinked.has(bt.id)) return false;
      if (Math.round(Number(bt.amount) * 100) !== cents) return false;
      const ref = creditCardRefOf(bt.description);
      const cardMatches = ref.last4 !== null && ref.last4 === bill.cardLastFour;
      const noCardNamed = ref.last4 === null;
      if (!cardMatches && !noCardNamed) return false; // names a different card
      const tolerance = cardMatches ? CHARGE_MATCH_DAYS : ISSUER_ONLY_MATCH_DAYS;
      return Math.abs(bt.transactionDate.getTime() - billTime) <= tolerance * DAY_MS;
    });
    if (candidates.length !== 1) continue; // no evidence, or ambiguous — ask the user instead
    const payment = candidates[0];
    claimed.add(payment.id);
    const hash = fingerprint({ key: bill.key, date: bill.date, name: bill.name, amount: bill.amount, kind: bill.kind, to: bill.to });
    const note = `אומת אוטומטית מול תנועת בנק ב-${payment.transactionDate.toISOString().slice(0, 10)} על ${bill.amount} ₪ שסווגה כסילוק כרטיס`;
    const snapshot = { key: bill.key, date: bill.date, name: bill.name, amount: bill.amount, kind: bill.kind, to: bill.to, fingerprint: hash, decision: "paid", note };
    try {
      created.push(await prisma.commitmentDecision.create({ data: { userId, eventKey: bill.key, fingerprint: hash, decision: "paid", note, bankTransactionId: payment.id,
        eventSnapshot: json(snapshot), history: json([{ at: new Date().toISOString(), before: null, after: { decision: "paid", note, bankTransactionId: payment.id } }]) } }));
    } catch (err) {
      // Unique constraint race: a concurrent request (or the user) already decided this bill first. Leave it — the next read reflects whatever won.
      if (!(err && typeof err === "object" && "code" in err && err.code === "P2002")) throw err;
    }
  }
  return created;
}

export async function commitments(userId: number): Promise<Commitment[]> {
  const today = businessDate();
  const [upcoming, cards, decisions] = await Promise.all([
    buildUpcoming(userId, 62, new Date(today), true),
    prisma.creditTransaction.findMany({ where: { userId, creditImport: { status: "confirmed" }, chargeDate: { not: null }, transactionType: { not: "financing" } }, include: { card: true }, orderBy: { id: "asc" } }),
    prisma.commitmentDecision.findMany({ where: { userId } }),
  ]);
  const rows: Array<Pick<Commitment, "key" | "date" | "name" | "amount" | "kind" | "to">> = upcoming.events.map(e => ({ key: e.key!, date: e.date.slice(0, 10), name: e.name,
    amount: e.amountKnown === false ? null : e.amount, kind: e.kind,
    to: e.kind === "loan" ? "/accounts?tab=loans" : `/commitments?tab=${e.kind === "subscription" ? "subscriptions" : e.kind === "recurring" ? "recurring" : "calendar"}` }));
  const bills = new Map<string, { key: string; date: string; name: string; amount: number; kind: string; to: string; cardId: number | null; cardLastFour: string | null }>();
  for (const tx of cards) {
    const date = tx.chargeDate!.toISOString().slice(0, 10);
    const key = `credit:${tx.cardId ?? "unassigned"}:${date}`;
    const bill = bills.get(key) ?? { key, date, name: tx.card?.name ?? "אשראי ללא כרטיס משויך", amount: 0, kind: "credit", to: "/accounts?tab=credit", cardId: tx.cardId, cardLastFour: tx.card?.lastFour ?? null };
    bill.amount = Math.round((bill.amount + Number(tx.amount)) * 100) / 100; bills.set(key, bill);
  }
  decisions.push(...await autoVerifyCardBills(userId, today, bills, decisions));
  // Advancing or removing a schedule is not evidence that its acknowledged debt was paid.
  for (const decision of decisions) {
    const saved = decision.eventSnapshot as unknown as Commitment | null;
    if (decision.decision === "unpaid" && saved && saved.date < today && !rows.some(r => r.key === saved.key) && !bills.has(saved.key)) rows.push(saved);
  }
  const result = [...rows, ...bills.values()].map(row => {
    const { key, date, name, amount, kind, to } = row;
    const hash = fingerprint({ key, date, name, amount, kind, to });
    const match = decisions.find(d => d.eventKey === row.key && d.fingerprint === hash);
    return { ...row, fingerprint: hash, decision: match?.decision ?? null, note: match?.note ?? null };
  }).sort((a,b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key));
  const decisionByKey = new Map(decisions.map(d => [d.eventKey, d]));
  const paymentIds = decisions.filter(d => d.decision === "paid" && d.bankTransactionId !== null).map(d => d.bankTransactionId!);
  const payments = paymentIds.length ? await prisma.bankTransaction.findMany({ where: { userId, id: { in: paymentIds } } }) : [];
  const paymentById = new Map(payments.map(p => [p.id, p]));
  const paymentUses = new Map<number, number>();
  for (const row of result) {
    const record = decisionByKey.get(row.key);
    if (row.decision === "paid" && record?.bankTransactionId != null) {
      paymentUses.set(record.bankTransactionId, (paymentUses.get(record.bankTransactionId) ?? 0) + 1);
    }
  }
  for (const row of result) {
    const record = decisionByKey.get(row.key);
    if (row.decision !== "paid" || record?.bankTransactionId == null) continue;
    const payment = paymentById.get(record.bankTransactionId);
    // A linked payment is evidence only while the original debit still exists
    // unchanged. Manual declarations have no linked transaction to validate.
    if (!payment || payment.type === "deposit" || row.amount === null ||
        Number(payment.amount) !== row.amount || payment.transactionDate > new Date(today) ||
        payment.updatedAt > record.createdAt || paymentUses.get(payment.id)! > 1) row.decision = null;
  }
  const allocations = new Map<string, Commitment[]>();
  for (const row of result) {
    if (row.decision !== "duplicate") continue;
    const record = decisionByKey.get(row.key);
    const target = result.find(r => r.key === record?.relatedEventKey);
    if (!target || target.decision !== "unpaid" || target.amount === null || row.amount === null || row.amount <= 0 || target.amount < row.amount) {
      row.decision = null;
      continue;
    }
    allocations.set(target.key, [...(allocations.get(target.key) ?? []), row]);
  }
  for (const [key, rows] of allocations) {
    const target = result.find(r => r.key === key)!;
    if (rows.reduce((sum, row) => sum + Math.round(row.amount! * 100), 0) > Math.round(target.amount! * 100)) {
      for (const row of rows) row.decision = null;
    }
  }
  return result;
}
