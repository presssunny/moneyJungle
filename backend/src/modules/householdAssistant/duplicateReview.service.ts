import { z } from "zod";
import type { DuplicateReview } from "../../../generated/prisma/client";
import { prisma, withFinancialTransaction } from "../../config/database";
import type { DuplicateReviewInput, DuplicateReviewResult, DuplicateReviewView } from "../../types/householdAssistant.types";
import { ApiError } from "../../utils/ApiError";
import { businessDate, nextDate } from "../../utils/date.utils";
import { expensesService } from "../expenses/expenses.service";
import { incomesService } from "../incomes/incomes.service";
import { fingerprint, json } from "../journey/journey.utils";
import { scanDuplicateEvidence } from "./duplicateScan.service";

const recordKey = z.string().regex(/^(expense|income|credit):[1-9]\d*$/);
const recordSchema = z.object({ key: recordKey, kind: z.enum(["expense", "income", "credit"]), name: z.string(), date: z.string(), amount: z.number(), to: z.string(), scope: z.string(), version: z.string() });
const evidenceSchema = z.object({ schemaVersion: z.literal(1), records: z.array(recordSchema).min(2) });
export const duplicateReviewInput = z.object({
  requestId: z.uuid(), candidateId: z.string().regex(/^duplicate:[a-f0-9]{24}$/),
  version: z.string().regex(/^[a-f0-9]{64}$/), decision: z.enum(["separate", "remove_manual", "source_charge"]),
  confirmed: z.literal(true), removedKey: recordKey.optional(), keptKey: recordKey.optional(),
}).strict();

type CurrentEvidence = Map<string, { version: string; raw: unknown }>;

async function currentEvidence(userId: number, keys: string[]): Promise<CurrentEvidence> {
  const ids = (kind: string) => keys.filter(key => key.startsWith(`${kind}:`)).map(key => Number(key.split(":")[1]));
  const [expenses, credit, incomes, links] = await Promise.all([
    prisma.expense.findMany({ where: { userId, id: { in: ids("expense") } }, include: { paymentMethod: true } }),
    prisma.creditTransaction.findMany({ where: { userId, id: { in: ids("credit") } }, include: { card: true, creditImport: true } }),
    prisma.income.findMany({ where: { userId, id: { in: ids("income") } } }),
    prisma.bankTransaction.findMany({ where: { userId, OR: [{ linkedExpenseId: { in: ids("expense") } }, { linkedIncomeId: { in: ids("income") } }] }, select: { linkedExpenseId: true, linkedIncomeId: true } }),
  ]);
  const linked = new Set(links.flatMap(r => [`expense:${r.linkedExpenseId}`, `income:${r.linkedIncomeId}`]));
  const result: CurrentEvidence = new Map();
  for (const [kind, rows] of [["expense", expenses], ["credit", credit], ["income", incomes]] as const) {
    for (const row of rows) {
      const key = `${kind}:${row.id}`;
      result.set(key, { version: fingerprint(linked.has(key) ? [row, "bank-linked"] : row), raw: row });
    }
  }
  return result;
}

export async function scanDuplicates(userId: number, today = businessDate()) {
  const [scan, reviews] = await Promise.all([
    scanDuplicateEvidence(userId, today),
    prisma.duplicateReview.findMany({ where: { userId, undoneAt: null }, select: { candidateId: true, evidenceVersion: true, evidence: true, decision: true } }),
  ]);
  const resolved = new Set(reviews.map(r => `${r.candidateId}:${r.evidenceVersion}`));
  const reviewedKeys = new Set(reviews.flatMap(r => evidenceSchema.parse(r.evidence).records.map(record => record.key)));
  const pending = scan.candidates.filter(c => !resolved.has(`${c.id}:${c.version}`));
  return { ...scan, followUpCount: reviews.filter(r => r.decision === "source_charge").length, candidateCount: pending.length, candidates: pending.slice(0, 50).map(c => ({ ...c, reopened: c.records.some(r => reviewedKeys.has(r.key)), records: c.records.slice(0, 20) })) };
}

export async function duplicateDetail(userId: number, candidateId: string) {
  return withFinancialTransaction(userId, async () => {
    const candidate = (await scanDuplicateEvidence(userId)).candidates.find(c => c.id === candidateId);
    if (!candidate) throw ApiError.conflict("הרשומות השתנו או שהבדיקה כבר אינה זמינה. יש לרענן את הרשימה.");
    return candidate;
  });
}

const snapshotFields = {
  id: z.number().int(), userId: z.number().int(), amount: z.string(), createdAt: z.string(), updatedAt: z.string(),
  description: z.string().nullable(), isRecurring: z.boolean(),
};
const expenseArchive = z.object({ ...snapshotFields, expenseDate: z.string(), businessName: z.string().nullable(), categoryId: z.number().nullable(), paymentMethodId: z.number().nullable(), source: z.literal("manual"), importRowId: z.null() });
const incomeArchive = z.object({ ...snapshotFields, incomeDate: z.string(), type: z.string() });

async function restoreBlocker(userId: number, review: DuplicateReview, current: CurrentEvidence): Promise<string | null> {
  if (review.decision !== "remove_manual") return null;
  const records = evidenceSchema.parse(review.evidence).records;
  if (!review.removedKey || current.has(review.removedKey)) return "הרשומה שהוסרה כבר קיימת. לא ניתן להוסיף אותה שוב.";
  if (records.some(r => r.key !== review.removedKey && current.get(r.key)?.version !== r.version)) return "רשומות המקור השתנו מאז התיקון. יש לבדוק אותן לפני שחזור.";
  const parsed = review.removedKey.startsWith("expense:") ? expenseArchive.safeParse(review.removedRecord) : incomeArchive.safeParse(review.removedRecord);
  if (!parsed.success || parsed.data.userId !== userId || review.removedKey !== `${review.removedKey.split(":")[0]}:${parsed.data.id}`) return "נתוני השחזור אינם זמינים.";
  const occupied = review.removedKey.startsWith("expense:")
    ? await prisma.expense.findUnique({ where: { id: parsed.data.id }, select: { id: true } })
    : await prisma.income.findUnique({ where: { id: parsed.data.id }, select: { id: true } });
  if (occupied) return "מזהה הרשומה אינו פנוי לשחזור. לא בוצע שינוי.";
  if ("categoryId" in parsed.data) {
    const { categoryId, paymentMethodId } = parsed.data;
    if (categoryId && !await prisma.category.findFirst({ where: { id: categoryId, OR: [{ userId }, { userId: null }] } })) return "הקטגוריה המקורית הוסרה. לא ניתן לשחזר את הרשומה בשלמותה.";
    if (paymentMethodId && !await prisma.paymentMethod.findFirst({ where: { id: paymentMethodId, OR: [{ userId }, { userId: null }] } })) return "אמצעי התשלום המקורי הוסר. לא ניתן לשחזר את הרשומה בשלמותה.";
  }
  return null;
}

async function reviewView(userId: number, review: DuplicateReview, current: CurrentEvidence, currentCandidates?: Set<string>, full = false): Promise<DuplicateReviewView> {
  const records = evidenceSchema.parse(review.evidence).records;
  const stable = records.every(r => r.key === review.removedKey ? !current.has(r.key) : current.get(r.key)?.version === r.version);
  // A newly added member reopens a whole-group decision, even if old rows are unchanged.
  const today = businessDate();
  const stillInWindow = records.every(r => r.date >= nextDate(today, -89) && r.date <= today);
  const membershipChanged = review.decision !== "remove_manual" && stillInWindow && currentCandidates && !currentCandidates.has(review.candidateId);
  const blocker = review.undoneAt ? null : await restoreBlocker(userId, review, current);
  return {
    id: review.id, candidateId: review.candidateId, decision: review.decision as DuplicateReviewView["decision"],
    version: fingerprint([review.id, review.undoneAt, records.map(r => [r.key, current.get(r.key)?.version ?? null])]),
    status: review.undoneAt ? "undone" : stable && !membershipChanged ? "active" : "stale",
    createdAt: review.createdAt.toISOString(), undoneAt: review.undoneAt?.toISOString() ?? null,
    records: full ? records : [...records.filter(r => r.key === review.removedKey || r.key === review.keptKey), ...records.filter(r => r.key !== review.removedKey && r.key !== review.keptKey)].slice(0, 20), recordCount: records.length, removedKey: review.removedKey, keptKey: review.keptKey,
    canUndo: !review.undoneAt && !blocker, undoBlockedReason: blocker,
  };
}

async function changedMoney(userId: number) {
  await prisma.financialProfile.upsert({ where: { userId }, create: { userId, revision: 1 }, update: { revision: { increment: 1 } } });
}

// Income carries no source column, unlike Expense: a bank row resolved as income
// whose link was lost is the only remaining trace that this row came from a
// statement. Deleting it would break the rolling balance with nothing left to show.
async function requireUnbankedIncome(userId: number, income: unknown) {
  const row = z.object({ amount: z.unknown(), incomeDate: z.date() }).parse(income);
  const orphan = await prisma.bankTransaction.findFirst({
    where: { userId, resolution: "income", linkedIncomeId: null, amount: row.amount as never, transactionDate: row.incomeDate },
    select: { id: true },
  });
  if (orphan) throw ApiError.conflict("להכנסה הזאת יש תנועת בנק מקבילה שאינה מקושרת. יש להשלים את ההתאמה במסך הבנק לפני הסרה.");
}

export async function decideDuplicate(userId: number, input: DuplicateReviewInput): Promise<DuplicateReviewResult> {
  return withFinancialTransaction(userId, async () => {
    const requestHash = fingerprint([input.requestId, input.candidateId, input.version, input.decision, input.removedKey ?? null, input.keptKey ?? null]);
    const previous = await prisma.duplicateReview.findUnique({ where: { userId_requestId: { userId, requestId: input.requestId } } });
    if (previous) {
      if (previous.requestHash !== requestHash) throw ApiError.conflict("הבקשה כבר שימשה להחלטה אחרת.");
      const current = await currentEvidence(userId, evidenceSchema.parse(previous.evidence).records.map(r => r.key));
      return { review: await reviewView(userId, previous, current), financialDomain: previous.removedKey?.startsWith("expense:") ? "expenses" : previous.removedKey ? "incomes" : null };
    }
    const candidate = (await scanDuplicateEvidence(userId)).candidates.find(c => c.id === input.candidateId);
    if (!candidate || candidate.version !== input.version) throw ApiError.conflict("הרשומות השתנו. יש לרענן ולבדוק אותן מחדש לפני אישור.");
    if (await prisma.duplicateReview.findFirst({ where: { userId, candidateId: candidate.id, evidenceVersion: candidate.version, undoneAt: null } })) throw ApiError.conflict("כבר נשמרה החלטה לרשומות האלה. אפשר לבטל אותה בהיסטוריה.");
    if (input.decision !== "remove_manual" && (input.removedKey || input.keptKey)) throw ApiError.badRequest("בחירת רשומה להסרה מותרת רק בתיקון רישום ידני.");
    if (input.decision === "source_charge" && candidate.records.some(r => r.kind !== "credit")) throw ApiError.badRequest("בירור חיוב במקור זמין לרשומות מדוח האשראי.");
    const current = await currentEvidence(userId, candidate.records.map(r => r.key));
    if (candidate.records.some(r => current.get(r.key)?.version !== r.version)) throw ApiError.conflict("המקורות השתנו. יש לרענן את הבדיקה.");
    let removedRecord: unknown;
    let financialDomain: DuplicateReviewResult["financialDomain"] = null;
    if (input.decision === "remove_manual") {
      const removed = candidate.records.find(r => r.key === input.removedKey);
      const kept = candidate.records.find(r => r.key === input.keptKey);
      if (!removed || !kept || removed.key === kept.key || removed.kind === "credit") throw ApiError.badRequest("יש לבחור רישום ידני להסרה ורשומה אחרת שנשארת. חיוב מדוח אשראי אינו נמחק כאן.");
      removedRecord = current.get(removed.key)!.raw;
      const id = Number(removed.key.split(":")[1]);
      if (removed.kind === "expense") { await expensesService.remove(userId, id); financialDomain = "expenses"; }
      else { await requireUnbankedIncome(userId, removedRecord); await incomesService.remove(userId, id); financialDomain = "incomes"; }
    }
    const review = await prisma.duplicateReview.create({ data: {
      userId, requestId: input.requestId, requestHash, candidateId: candidate.id, evidenceVersion: candidate.version, decision: input.decision,
      evidence: json({ schemaVersion: 1, records: candidate.records }),
      removedKey: input.removedKey, keptKey: input.keptKey,
      ...(removedRecord ? { removedRecord: json(removedRecord) } : {}),
    } });
    if (financialDomain) await changedMoney(userId);
    if (input.removedKey) current.delete(input.removedKey);
    return { review: await reviewView(userId, review, current), financialDomain };
  });
}

export async function duplicateHistory(userId: number, cursor?: string, followUp = false) {
  return withFinancialTransaction(userId, async () => {
    const anchor = cursor ? await prisma.duplicateReview.findFirst({ where: { id: cursor, userId } }) : null;
    if (cursor && !anchor) throw ApiError.notFound("ההחלטה לא נמצאה.");
    const reviews = await prisma.duplicateReview.findMany({
      where: { userId, ...(followUp ? { decision: "source_charge", undoneAt: null } : {}), ...(anchor ? { OR: [{ createdAt: { lt: anchor.createdAt } }, { createdAt: anchor.createdAt, id: { lt: anchor.id } }] } : {}) },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 21,
    });
    const page = reviews.slice(0, 20);
    const [current, scan] = await Promise.all([currentEvidence(userId, page.flatMap(r => evidenceSchema.parse(r.evidence).records.map(record => record.key))), scanDuplicateEvidence(userId)]);
    const candidates = scan.limited ? undefined : new Set(scan.candidates.map(c => c.id));
    return { items: await Promise.all(page.map(r => reviewView(userId, r, current, candidates))), nextCursor: reviews.length > 20 ? page.at(-1)!.id : null };
  });
}

export async function undoDuplicate(userId: number, id: string, version: string): Promise<DuplicateReviewResult> {
  return withFinancialTransaction(userId, async () => {
    const review = await prisma.duplicateReview.findFirst({ where: { userId, id } });
    if (!review) throw ApiError.notFound("ההחלטה לא נמצאה.");
    const records = evidenceSchema.parse(review.evidence).records;
    const current = await currentEvidence(userId, records.map(r => r.key));
    const view = await reviewView(userId, review, current);
    if (review.undoneAt) return { review: view, financialDomain: null };
    if (view.version !== version) throw ApiError.conflict("הנתונים השתנו. יש לרענן את ההיסטוריה לפני ביטול.");
    if (!view.canUndo) throw ApiError.conflict(view.undoBlockedReason ?? "לא ניתן לבטל את ההחלטה.");
    let financialDomain: DuplicateReviewResult["financialDomain"] = null;
    if (review.removedKey?.startsWith("expense:")) {
      const original = expenseArchive.parse(review.removedRecord);
      await prisma.expense.create({ data: { ...original, expenseDate: new Date(original.expenseDate), createdAt: new Date(original.createdAt), updatedAt: new Date() } });
      financialDomain = "expenses";
    } else if (review.removedKey?.startsWith("income:")) {
      const original = incomeArchive.parse(review.removedRecord);
      await prisma.income.create({ data: { ...original, incomeDate: new Date(original.incomeDate), createdAt: new Date(original.createdAt), updatedAt: new Date() } });
      financialDomain = "incomes";
    }
    const undone = await prisma.duplicateReview.update({ where: { id }, data: { undoneAt: new Date() } });
    if (financialDomain) await changedMoney(userId);
    const refreshed = await currentEvidence(userId, records.map(r => r.key));
    return { review: await reviewView(userId, undone, refreshed), financialDomain };
  });
}
