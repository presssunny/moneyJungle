import { prisma, withFinancialTransaction } from "../../config/database";
import type { AssistantAction, HouseholdSnapshot } from "../../types/householdAssistant.types";
import { businessDate, nextDate } from "../../utils/date.utils";
import { aiAvailable } from "../ai/ai.service";
import { monthTotals } from "../dashboard/dashboard.service";
import { journeyActions, upcomingCommitments } from "../journey/actions.service";
import { financialStatus } from "../journey/coverage.service";
import { fingerprint } from "../journey/journey.utils";
import { duplicateCandidates, type ScanRecord } from "./duplicates";

const SCAN_LIMIT = 2000;
const day = (date: Date) => date.toISOString().slice(0, 10);
const expenseLink = (name: string, date: string) => `/transactions?tab=expenses&q=${encodeURIComponent(name)}&from=${date}&to=${date}&month=${date.slice(0, 7)}`;

export async function scanDuplicates(userId: number, today = businessDate()): Promise<HouseholdSnapshot["duplicates"]> {
  const from = nextDate(today, -89);
  const dates = { gte: new Date(from), lt: new Date(nextDate(today, 1)) };
  const [expenses, credit, incomes, linked] = await Promise.all([
    prisma.expense.findMany({ where: { userId, expenseDate: dates, source: "manual", importRowId: null }, include: { paymentMethod: true }, orderBy: [{ expenseDate: "desc" }, { id: "asc" }], take: SCAN_LIMIT + 1 }),
    prisma.creditTransaction.findMany({ where: { userId, transactionDate: dates, creditImport: { status: "confirmed" }, paymentCount: 1, transactionType: { in: ["regular", "standing_order"] } }, orderBy: [{ transactionDate: "desc" }, { id: "asc" }], take: SCAN_LIMIT + 1 }),
    prisma.income.findMany({ where: { userId, incomeDate: dates }, orderBy: [{ incomeDate: "desc" }, { id: "asc" }], take: SCAN_LIMIT + 1 }),
    prisma.bankTransaction.findMany({ where: { userId, OR: [{ linkedExpenseId: { not: null } }, { linkedIncomeId: { not: null } }] }, select: { linkedExpenseId: true, linkedIncomeId: true } }),
  ]);
  const linkedExpenses = new Set(linked.map(r => r.linkedExpenseId));
  const linkedIncomes = new Set(linked.map(r => r.linkedIncomeId));
  const rows: ScanRecord[] = [
    ...expenses.slice(0, SCAN_LIMIT).filter(r => !linkedExpenses.has(r.id)).map(r => {
      const name = r.businessName?.trim() || r.description?.trim() || "";
      return { key: `expense:${r.id}`, kind: "expense" as const, name, date: day(r.expenseDate), amount: Number(r.amount), to: expenseLink(name, day(r.expenseDate)), scope: String(r.paymentMethodId ?? "unknown"), manual: true, cardEligible: !r.paymentMethod || r.paymentMethod.type === "credit_card" };
    }),
    ...credit.slice(0, SCAN_LIMIT).filter(r => r.cardId !== null).map(r => ({ key: `credit:${r.id}`, kind: "credit" as const, name: r.businessName, date: day(r.transactionDate), amount: Number(r.amount), to: `/accounts?tab=credit&importId=${r.creditImportId}`, scope: String(r.cardId), manual: false, cardEligible: false })),
    ...incomes.slice(0, SCAN_LIMIT).filter(r => !linkedIncomes.has(r.id)).map(r => ({ key: `income:${r.id}`, kind: "income" as const, name: r.description?.trim() || "", date: day(r.incomeDate), amount: Number(r.amount), to: `/transactions?tab=incomes&month=${day(r.incomeDate).slice(0, 7)}`, scope: r.type, manual: true, cardEligible: false })),
  ];
  const candidates = duplicateCandidates(rows);
  return { from, to: today, scanned: rows.length, limited: [expenses, credit, incomes].some(r => r.length > SCAN_LIMIT), candidateCount: candidates.length, candidates: candidates.slice(0, 50) };
}

export async function householdSnapshot(userId: number): Promise<HouseholdSnapshot> {
  // Reuse the same owner lock as imports so the snapshot cannot straddle a commit.
  return withFinancialTransaction(userId, async () => {
    const state = await financialStatus(userId);
    const [year, month] = state.today.split("-").map(Number);
    const [totals, duplicates, existing] = await Promise.all([
      monthTotals(userId, year, month), scanDuplicates(userId, state.today), journeyActions(userId, state),
    ]);
    const actions: AssistantAction[] = existing.map(a => ({
      id: a.id, title: a.title, reason: a.reason, to: a.to, priority: a.priority,
      kind: a.id.startsWith("goal:") ? "goal" : a.to.startsWith("/budgets") ? "budget" : a.dueDate ? "payment" : "review",
    }));
    if (state.blockers.length && !actions.some(a => a.priority < 15)) actions.unshift({ id: "assistant:coverage", kind: "review", title: "השלמת תמונת הכסף", reason: "חסר מידע לפני שאפשר להעריך כמה כסף פנוי להמשך החודש.", to: "/data", priority: -1 });
    if (duplicates.candidateCount) actions.push({ id: "assistant:duplicates", kind: "duplicate", title: "בדיקת רישומים דומים", reason: "יש רשומות עם אותו שם, יום וסכום. ייתכן שאלו עסקאות שונות — נבדוק מול המקור.", to: "/assistant#duplicates", priority: 30 });
    const ordered = actions.sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
    const upcoming = upcomingCommitments(state).map(({ key, name, date, amount, to }) => ({ key, name, date, amount, to }));
    const snapshot = {
      month: state.today.slice(0, 7), hasActivity: state.hasActivity, totals,
      allowance: { amount: state.allowance.amount, state: state.allowance.state }, blockers: state.blockers,
      actions: ordered.slice(0, 30), actionCount: ordered.length, upcoming, duplicates,
    };
    return { ...snapshot, version: fingerprint([state.dataVersion, snapshot]), generatedAt: new Date().toISOString(), aiAvailable: aiAvailable() };
  });
}
