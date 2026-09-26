import { z } from "zod";
import { prisma } from "../../config/database";
import { ApiError } from "../../utils/ApiError";
import { creditCardRefOf } from "../bank/bankParser.service";
import { commitments } from "./commitments.service";

const SOURCE_KINDS = ["recurring", "subscription", "loan", "reminder", "credit"] as const;
const SOURCE_KEY = /^(recurring|subscription|loan|reminder|credit):\d+$/;

/** "reminder:12:2026-09-30" → "reminder:12"; a card bill "credit:4:2026-10-02" → "credit:4". A bill with no card has no source. */
export function sourceKeyOf(eventKey: string): string | null {
  const [kind, id] = eventKey.split(":");
  return (SOURCE_KINDS as readonly string[]).includes(kind) && /^\d+$/.test(id ?? "") ? `${kind}:${id}` : null;
}

export interface FundingSource {
  sourceKey: string;
  name: string;
  kind: string;
  assignedAccountId: number | null;
  /** Inferred from statements; never counts until the household confirms it. */
  suggestedAccountId: number | null;
  suggestionReason: string | null;
}

/**
 * A card is suggested only from settlement rows that name its last four digits,
 * and only when every such row sits in one account; a loan only from rows linked
 * to it. Issuer-only matches and cards paid from several accounts get no suggestion.
 */
async function suggestions(userId: number, cards: Array<{ id: number; lastFour: string }>) {
  const [settlements, loanRows] = await Promise.all([
    prisma.bankTransaction.findMany({ where: { userId, resolution: "credit_card_settled" }, select: { bankAccountId: true, description: true } }),
    prisma.bankTransaction.findMany({ where: { userId, linkedLoanId: { not: null } }, select: { bankAccountId: true, linkedLoanId: true } }),
  ]);
  const found = new Map<string, Set<number>>();
  const add = (key: string, accountId: number) => found.set(key, (found.get(key) ?? new Set()).add(accountId));
  for (const row of settlements) {
    const last4 = creditCardRefOf(row.description).last4;
    const card = last4 ? cards.find((c) => c.lastFour === last4) : undefined;
    if (card) add(`credit:${card.id}`, row.bankAccountId);
  }
  for (const row of loanRows) add(`loan:${row.linkedLoanId}`, row.bankAccountId);
  const result = new Map<string, { accountId: number; reason: string }>();
  for (const [key, accounts] of found) {
    if (accounts.size !== 1) continue;
    result.set(key, { accountId: [...accounts][0], reason: key.startsWith("credit:") ? "חיובי הכרטיס נפרעו רק מחשבון זה" : "תשלומי ההלוואה ירדו רק מחשבון זה" });
  }
  return result;
}

export async function fundingOverview(userId: number) {
  const [profile, accounts, cards, events, assignments] = await Promise.all([
    prisma.financialProfile.findUnique({ where: { userId }, select: { spendingAccountId: true, savedReserveLocation: true, savedReserve: true } }),
    prisma.bankAccount.findMany({ where: { userId }, select: { id: true, accountName: true }, orderBy: { id: "asc" } }),
    prisma.creditCard.findMany({ where: { userId }, select: { id: true, name: true, lastFour: true }, orderBy: { id: "asc" } }),
    commitments(userId),
    prisma.fundingAssignment.findMany({ where: { userId }, select: { sourceKey: true, bankAccountId: true } }),
  ]);
  const suggested = await suggestions(userId, cards);
  const assigned = new Map(assignments.map((a) => [a.sourceKey, a.bankAccountId]));
  const sources = new Map<string, FundingSource>();
  const add = (sourceKey: string, name: string, kind: string) => {
    if (sources.has(sourceKey)) return;
    const suggestion = suggested.get(sourceKey);
    sources.set(sourceKey, { sourceKey, name, kind, assignedAccountId: assigned.get(sourceKey) ?? null, suggestedAccountId: suggestion?.accountId ?? null, suggestionReason: suggestion?.reason ?? null });
  };
  for (const card of cards) add(`credit:${card.id}`, card.name, "credit");
  for (const event of events) {
    const key = sourceKeyOf(event.key);
    if (key) add(key, event.name, event.kind);
  }
  return {
    accounts: accounts.map((a) => ({ id: a.id, name: a.accountName })),
    spendingAccountId: profile?.spendingAccountId ?? null,
    savedReserve: Number(profile?.savedReserve ?? 0),
    savedReserveLocation: profile?.savedReserveLocation ?? null,
    sources: [...sources.values()],
  };
}

export const fundingInput = z.object({
  spendingAccountId: z.number().int().positive().nullable().optional(),
  savedReserveLocation: z.enum(["spending", "elsewhere"]).nullable().optional(),
  assignments: z.array(z.object({ sourceKey: z.string().regex(SOURCE_KEY), bankAccountId: z.number().int().positive().nullable() }).strict()).max(500).optional(),
}).strict();

async function sourceExists(userId: number, sourceKey: string) {
  const [kind, raw] = sourceKey.split(":");
  const where = { id: Number(raw), userId };
  switch (kind) {
    case "recurring": return Boolean(await prisma.recurringPayment.findFirst({ where, select: { id: true } }));
    case "subscription": return Boolean(await prisma.subscription.findFirst({ where, select: { id: true } }));
    case "loan": return Boolean(await prisma.loan.findFirst({ where, select: { id: true } }));
    case "reminder": return Boolean(await prisma.reminder.findFirst({ where, select: { id: true } }));
    default: return Boolean(await prisma.creditCard.findFirst({ where, select: { id: true } }));
  }
}

/** Confirms the household's choices. Any change is a money-picture change, so it bumps the revision like any other. */
export async function saveFunding(userId: number, input: z.infer<typeof fundingInput>) {
  const owned = new Set((await prisma.bankAccount.findMany({ where: { userId }, select: { id: true } })).map((a) => a.id));
  const accountIds = [input.spendingAccountId, ...(input.assignments ?? []).map((a) => a.bankAccountId)].filter((id): id is number => typeof id === "number");
  if (accountIds.some((id) => !owned.has(id))) throw ApiError.badRequest("החשבון שנבחר אינו שייך לחשבון המחובר");
  for (const assignment of input.assignments ?? []) {
    if (!(await sourceExists(userId, assignment.sourceKey))) throw ApiError.badRequest("אחת ההתחייבויות אינה קיימת עוד — יש לרענן");
  }
  await prisma.$transaction(async (tx) => {
    await tx.financialProfile.upsert({
      where: { userId },
      create: { userId, revision: 1, spendingAccountId: input.spendingAccountId ?? null, savedReserveLocation: input.savedReserveLocation ?? null },
      update: {
        revision: { increment: 1 },
        ...(input.spendingAccountId !== undefined ? { spendingAccountId: input.spendingAccountId } : {}),
        ...(input.savedReserveLocation !== undefined ? { savedReserveLocation: input.savedReserveLocation } : {}),
      },
    });
    for (const { sourceKey, bankAccountId } of input.assignments ?? []) {
      if (bankAccountId === null) await tx.fundingAssignment.deleteMany({ where: { userId, sourceKey } });
      else await tx.fundingAssignment.upsert({ where: { userId_sourceKey: { userId, sourceKey } }, create: { userId, sourceKey, bankAccountId }, update: { bankAccountId, confirmedAt: new Date() } });
    }
  });
  return fundingOverview(userId);
}
