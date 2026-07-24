import { prisma } from "../../config/database";

/**
 * Shared auto-categorization used by every importer (credit, bank, Excel).
 * Builds a matcher from the user's category rules (user rules win over defaults),
 * so the categorization logic lives in ONE place instead of being copied per module.
 */
export async function buildRuleCategorizer(userId: number): Promise<(text: string) => number | null> {
  const rules = await prisma.categoryRule.findMany({
    where: { OR: [{ userId }, { userId: null }] },
    orderBy: { userId: "desc" }, // user rules first (nulls last)
  });
  const normalized = rules.map((rule) => ({
    keyword: rule.keyword.toLowerCase(),
    categoryId: rule.categoryId,
  }));
  return (text: string): number | null => {
    const lowered = text.toLowerCase();
    return normalized.find((rule) => lowered.includes(rule.keyword))?.categoryId ?? null;
  };
}
