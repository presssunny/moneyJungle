import { prisma } from "../../config/database";
import { parseExpensesFile } from "./importsParser.service";

/** Hebrew payment-method words → PaymentMethod.type, for matching sheet cells. */
const METHOD_TYPE_KEYWORDS: Array<{ type: string; keywords: string[] }> = [
  { type: "credit_installments", keywords: ["תשלומים"] },
  { type: "credit_card", keywords: ["אשראי"] },
  { type: "cash", keywords: ["מזומן"] },
  { type: "check", keywords: ["שיק", "צ'ק", "צק"] },
  { type: "standing_order", keywords: ["הוראת קבע", "ה.קבע", "הו\"ק"] },
  { type: "bank_transfer", keywords: ["העברה"] },
  { type: "bit", keywords: ["ביט", "bit"] },
  { type: "paybox", keywords: ["פייבוקס", "paybox"] },
];

async function buildMethodMatcher(userId: number) {
  const methods = await prisma.paymentMethod.findMany({
    where: { OR: [{ userId }, { userId: null }] },
  });
  return (text: string | null): number | null => {
    if (!text) return null;
    const lowered = text.toLowerCase();
    const byName = methods.find(
      (m) => lowered.includes(m.name.toLowerCase()) || m.name.toLowerCase().includes(lowered)
    );
    if (byName) return byName.id;
    const keywordMatch = METHOD_TYPE_KEYWORDS.find((entry) =>
      entry.keywords.some((keyword) => lowered.includes(keyword))
    );
    if (keywordMatch) {
      const byType = methods.find((m) => m.type === keywordMatch.type);
      if (byType) return byType.id;
    }
    return null;
  };
}

async function buildCategorizer(userId: number) {
  const [rules, categories] = await Promise.all([
    prisma.categoryRule.findMany({
      where: { OR: [{ userId }, { userId: null }] },
      orderBy: { userId: "desc" },
    }),
    prisma.category.findMany({ where: { OR: [{ userId }, { userId: null }] } }),
  ]);
  const normalizedRules = rules.map((rule) => ({
    keyword: rule.keyword.toLowerCase(),
    categoryId: rule.categoryId,
  }));
  return (name: string, categoryText: string | null): number | null => {
    if (categoryText) {
      const lowered = categoryText.toLowerCase();
      const byName = categories.find(
        (c) => lowered.includes(c.name.toLowerCase()) || c.name.toLowerCase().includes(lowered)
      );
      if (byName) return byName.id;
    }
    const loweredName = name.toLowerCase();
    const rule = normalizedRules.find((r) => loweredName.includes(r.keyword));
    return rule?.categoryId ?? null;
  };
}

export const importsService = {
  /**
   * Import a monthly-plan Excel into expenses for the given month.
   * Existing rows with the same name+amount in that month are skipped,
   * so re-uploading the same file is safe.
   */
  async importExpenses(userId: number, buffer: Buffer, year: number, month: number) {
    const rows = parseExpensesFile(buffer);
    const [matchMethod, categorize] = await Promise.all([
      buildMethodMatcher(userId),
      buildCategorizer(userId),
    ]);

    // Each row keeps its OWN date when the sheet provides one, so a multi-month
    // file is not collapsed into the selected month. Rows without a date fall
    // back to the 1st of the selected month (matches the family's plan sheet).
    const fallback = new Date(Date.UTC(year, month - 1, 1));
    const dateKey = (d: Date) => d.toISOString().slice(0, 10);
    const dated = rows.map((row) => ({ row, expenseDate: row.date ?? fallback }));

    // Dedupe across the full span the rows actually cover
    const dates = dated.map((d) => d.expenseDate.getTime());
    const spanStart = new Date(Math.min(...dates, fallback.getTime()));
    const spanEnd = new Date(Math.max(...dates, fallback.getTime()) + 86400000);
    const existing = await prisma.expense.findMany({
      where: { userId, expenseDate: { gte: spanStart, lt: spanEnd } },
      select: { businessName: true, amount: true, expenseDate: true },
    });
    const existingKeys = new Set(
      existing.map((e) => `${e.businessName}|${Number(e.amount)}|${dateKey(e.expenseDate)}`)
    );

    let created = 0;
    let totalAmount = 0;
    const monthsTouched = new Set<string>();
    for (const { row, expenseDate } of dated) {
      const key = `${row.name}|${row.amount}|${dateKey(expenseDate)}`;
      if (existingKeys.has(key)) continue;
      existingKeys.add(key);
      await prisma.expense.create({
        data: {
          userId,
          amount: row.amount,
          categoryId: categorize(row.name, row.categoryText),
          paymentMethodId: matchMethod(row.paymentMethodText),
          businessName: row.name,
          description: "יובא מאקסל",
          expenseDate,
          isRecurring: false,
        },
      });
      created += 1;
      totalAmount += row.amount;
      monthsTouched.add(dateKey(expenseDate).slice(0, 7));
    }

    return {
      parsed: rows.length,
      created,
      skipped: rows.length - created,
      totalAmount: Math.round(totalAmount * 100) / 100,
      months: [...monthsTouched].sort(),
    };
  },
};
