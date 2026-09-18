import { prisma } from "../../config/database";
import { buildUpcoming } from "../dashboard/cashflow.service";
import { businessDate, fingerprint } from "./journey.utils";
export interface Commitment {
  key: string; date: string; name: string; amount: number | null; kind: string;
  fingerprint: string; decision: string | null; note: string | null; to: string;
}
export async function commitments(userId: number): Promise<Commitment[]> {
  const today = businessDate();
  const [upcoming, cards, decisions] = await Promise.all([
    buildUpcoming(userId, 62, new Date(today), true),
    prisma.creditTransaction.findMany({ where: { userId, creditImport: { status: "confirmed" }, chargeDate: { not: null }, transactionType: { not: "financing" } }, include: { card: true }, orderBy: { id: "asc" } }),
    prisma.commitmentDecision.findMany({ where: { userId } }),
  ]);
  const rows = upcoming.events.map(e => ({ key: e.key!, date: e.date.slice(0, 10), name: e.name,
    amount: e.amountKnown === false ? null : e.amount, kind: e.kind,
    to: e.kind === "loan" ? "/accounts?tab=loans" : `/commitments?tab=${e.kind === "subscription" ? "subscriptions" : e.kind === "recurring" ? "recurring" : "calendar"}` }));
  const bills = new Map<string, { key: string; date: string; name: string; amount: number; kind: string; to: string }>();
  for (const tx of cards) {
    const date = tx.chargeDate!.toISOString().slice(0, 10);
    const key = `credit:${tx.cardId ?? "unassigned"}:${date}`;
    const bill = bills.get(key) ?? { key, date, name: tx.card?.name ?? "אשראי ללא כרטיס משויך", amount: 0, kind: "credit", to: "/accounts?tab=credit" };
    bill.amount = Math.round((bill.amount + Number(tx.amount)) * 100) / 100; bills.set(key, bill);
  }
  const result = [...rows, ...bills.values()].map(row => {
    const hash = fingerprint(row);
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
