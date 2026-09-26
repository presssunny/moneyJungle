import { prisma } from "../../config/database";
import type { HouseholdSnapshot } from "../../types/householdAssistant.types";
import { businessDate, nextDate } from "../../utils/date.utils";
import { fingerprint } from "../journey/journey.utils";
import { duplicateCandidates, type ScanRecord } from "./duplicates";

const SCAN_LIMIT = 2000;
const day = (date: Date) => date.toISOString().slice(0, 10);
const expenseLink = (name: string, date: string) => `/transactions?tab=expenses&q=${encodeURIComponent(name)}&from=${date}&to=${date}&month=${date.slice(0, 7)}`;

export async function scanDuplicateEvidence(userId: number, today = businessDate()): Promise<HouseholdSnapshot["duplicates"]> {
  const from = nextDate(today, -89);
  const dates = { gte: new Date(from), lt: new Date(nextDate(today, 1)) };
  const [expenses, credit, incomes, linked] = await Promise.all([
    prisma.expense.findMany({ where: { userId, expenseDate: dates, source: "manual", importRowId: null }, include: { paymentMethod: true }, orderBy: [{ expenseDate: "desc" }, { id: "asc" }], take: SCAN_LIMIT + 1 }),
    prisma.creditTransaction.findMany({ where: { userId, transactionDate: dates, creditImport: { status: "confirmed" }, paymentCount: 1, transactionType: { in: ["regular", "standing_order"] } }, include: { card: true, creditImport: true }, orderBy: [{ transactionDate: "desc" }, { id: "asc" }], take: SCAN_LIMIT + 1 }),
    prisma.income.findMany({ where: { userId, incomeDate: dates, source: "manual" }, orderBy: [{ incomeDate: "desc" }, { id: "asc" }], take: SCAN_LIMIT + 1 }),
    prisma.bankTransaction.findMany({ where: { userId, OR: [{ linkedExpenseId: { not: null } }, { linkedIncomeId: { not: null } }] }, select: { linkedExpenseId: true, linkedIncomeId: true } }),
  ]);
  const linkedExpenses = new Set(linked.map(r => r.linkedExpenseId));
  const linkedIncomes = new Set(linked.map(r => r.linkedIncomeId));
  const rows: ScanRecord[] = [
    ...expenses.slice(0, SCAN_LIMIT).filter(r => !linkedExpenses.has(r.id)).map(r => {
      const name = r.businessName?.trim() || r.description?.trim() || "";
      return { key: `expense:${r.id}`, kind: "expense" as const, version: fingerprint(r), name, date: day(r.expenseDate), amount: Number(r.amount), to: expenseLink(name, day(r.expenseDate)), scope: String(r.paymentMethodId ?? "unknown"), manual: true, cardEligible: !r.paymentMethod || r.paymentMethod.type === "credit_card" };
    }),
    ...credit.slice(0, SCAN_LIMIT).filter(r => r.cardId !== null).map(r => ({ key: `credit:${r.id}`, kind: "credit" as const, version: fingerprint(r), name: r.businessName, date: day(r.transactionDate), amount: Number(r.amount), to: `/accounts?tab=credit&importId=${r.creditImportId}`, scope: String(r.cardId), manual: false, cardEligible: false })),
    ...incomes.slice(0, SCAN_LIMIT).filter(r => !linkedIncomes.has(r.id)).map(r => ({ key: `income:${r.id}`, kind: "income" as const, version: fingerprint(r), name: r.description?.trim() || "", date: day(r.incomeDate), amount: Number(r.amount), to: `/transactions?tab=incomes&month=${day(r.incomeDate).slice(0, 7)}`, scope: r.type, manual: true, cardEligible: false })),
  ];
  const candidates = duplicateCandidates(rows);
  return { from, to: today, scanned: rows.length, limited: [expenses, credit, incomes].some(r => r.length > SCAN_LIMIT), candidateCount: candidates.length, candidates };
}

