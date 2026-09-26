import { z } from "zod";
import type { QuestionIntent } from "../../types/householdAssistant.types";

export const HEBREW_MONTHS = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];

/** "current" and "previous" are resolved against the Jerusalem business date on the server. */
export const monthParam = z.union([z.enum(["current", "previous"]), z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)]);
export type MonthParam = z.infer<typeof monthParam>;

export const routedQuestion = z.discriminatedUnion("intent", [
  z.object({ intent: z.literal("month_totals"), month: monthParam.default("current") }).strict(),
  z.object({ intent: z.literal("category_spend"), month: monthParam.default("current"), category: z.string().min(1).max(60) }).strict(),
  z.object({ intent: z.literal("allowance") }).strict(),
  z.object({ intent: z.literal("upcoming") }).strict(),
  z.object({ intent: z.literal("loans") }).strict(),
  z.object({ intent: z.literal("goals") }).strict(),
  z.object({ intent: z.literal("net_worth") }).strict(),
  z.object({ intent: z.literal("document_summary") }).strict(),
  z.object({ intent: z.literal("document_interest") }).strict(),
]);
export type RoutedQuestion = z.infer<typeof routedQuestion>;

/** What the model may choose from. Descriptions only — never a figure, record or name. */
export const INTENT_CATALOGUE: Record<QuestionIntent, { scope: "household" | "document"; description: string; params?: string }> = {
  month_totals: { scope: "household", description: "money in, money out and what is left in a month", params: 'month: "current" | "previous" | "YYYY-MM"' },
  category_spend: { scope: "household", description: "spending in one category in a month", params: 'month as above; category: the category words exactly as the user wrote them' },
  allowance: { scope: "household", description: "how much can be spent today" },
  upcoming: { scope: "household", description: "payments and charges due soon" },
  loans: { scope: "household", description: "loan balances and monthly repayments" },
  goals: { scope: "household", description: "progress of savings, purchase and loan-payoff goals" },
  net_worth: { scope: "household", description: "assets minus debts" },
  document_summary: { scope: "document", description: "what one uploaded file contained and what became of it" },
  document_interest: { scope: "document", description: "interest in one uploaded file" },
};

export const EXAMPLES: Record<"household" | "document", string[]> = {
  household: ["כמה הוצאתי החודש?", "כמה הוצאתי על מזון בחודש שעבר?", "כמה מותר להוציא היום?", "מה צפוי לרדת השבוע?", "כמה נשאר להחזיר על ההלוואות?", "איך אני מתקדמת ביעדים?"],
  document: ["מה היה בקובץ הזה?", "כמה ריבית יש בדף הזה?"],
};

// Hebrew has no \b in JS regex (CLAUDE.md), so patterns match on substrings.
function monthOf(question: string, today: string): MonthParam {
  if (/חודש שעבר|חודש הקודם|בחודש קודם/.test(question)) return "previous";
  const index = HEBREW_MONTHS.findIndex((name) => question.includes(name));
  if (index < 0) return "current";
  const year = question.match(/20\d\d/)?.[0];
  const [thisYear, thisMonth] = today.split("-").map(Number);
  // A month name without a year means its latest occurrence, never a future month.
  const resolvedYear = year ? Number(year) : index + 1 > thisMonth ? thisYear - 1 : thisYear;
  return `${resolvedYear}-${String(index + 1).padStart(2, "0")}`;
}

/** Local routing: answers the common questions without any external call. */
export function matchQuestion(question: string, today: string, categories: string[], documentScoped: boolean): RoutedQuestion | null {
  const q = question.trim();
  if (documentScoped) return /ריבית/.test(q) ? { intent: "document_interest" } : { intent: "document_summary" };
  const spendWords = /הוצאתי|הוצאות|הוצאנו|שילמתי|שילמנו|יצא|יצאו/.test(q);
  const category = categories.filter((name) => name.length > 1 && q.includes(name)).sort((a, b) => b.length - a.length)[0];
  if (spendWords && category) return { intent: "category_spend", month: monthOf(q, today), category };
  if (/מותר להוציא|אפשר להוציא|להוציא היום|תקציב יומי/.test(q)) return { intent: "allowance" };
  if (/צפוי|קרוב|קרובים|השבוע|לרדת|יורד|תשלומים הבאים|חיובים הבאים/.test(q)) return { intent: "upcoming" };
  if (/הלווא|משכנתא|להחזיר|חובות/.test(q)) return { intent: "loans" };
  if (/יעד|חיסכון|חסכתי|חסכנו/.test(q)) return { intent: "goals" };
  if (/שווי|נכסים|נטו/.test(q)) return { intent: "net_worth" };
  if (spendWords || /הכנסות|הרווחתי|נכנס|נכנסו|נשאר|עודף|מאזן/.test(q)) return { intent: "month_totals", month: monthOf(q, today) };
  return null;
}
