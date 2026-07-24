import { ApiError } from "../../utils/ApiError";
import { decimalToNumber } from "../../utils/money.utils";
import { buildRuleCategorizer } from "../categories/categorization.service";
import { expensesRepository } from "./expenses.repository";

/**
 * Deterministic Hebrew free-text parser for quick expense entry — no LLM/keys.
 * Turns "קניתי בשופרסל ב-250" or "שופרסל 250 אתמול" into { amount, businessName,
 * date }, then reuses the same keyword categorizer as the credit importer so the
 * new expense auto-lands in the right category.
 */

const CURRENCY = /₪|שקלים|שקל|ש["״'`]?ח|nis|ils/gi;
// Common Hebrew filler verbs/prepositions that aren't part of the business name.
const FILLER = new Set([
  "קניתי", "קנינו", "שילמתי", "שילמנו", "הוצאתי", "הוצאנו", "עלה", "עלות",
  "בסך", "בסכום", "עבור", "על", "את", "של", "ב", "ל", "מ", "אני", "היה",
]);
// Single-letter Hebrew prefixes to strip from a token when a real word remains.
const PREFIXES = ["ב", "ל", "ה", "מ", "ו", "ש", "כ"];
// Relative-date words — removed from the business name (JS \b doesn't work on Hebrew).
const DATE_WORDS = new Set(["אתמול", "שלשום", "היום"]);

export interface QuickParse {
  amount: number | null;
  businessName: string;
  date: Date;
}

function stripPrefix(word: string): string {
  if (word.length > 3 && PREFIXES.includes(word[0]) && !PREFIXES.includes(word[1])) {
    return word.slice(word[1] === "־" || word[1] === "-" ? 2 : 1);
  }
  return word;
}

export function parseQuickAdd(text: string): QuickParse {
  const raw = text.trim();

  // Relative date words (plain includes — Hebrew has no ASCII word boundaries)
  const date = new Date();
  if (raw.includes("אתמול")) date.setDate(date.getDate() - 1);
  else if (raw.includes("שלשום")) date.setDate(date.getDate() - 2);

  // Amounts — prefer a number sitting next to a currency word, else the largest.
  const numbers = [...raw.matchAll(/\d+(?:[.,]\d+)?/g)].map((m) => ({
    raw: m[0],
    index: m.index ?? 0,
    value: parseFloat(m[0].replace(",", ".")),
  }));
  let amount: number | null = null;
  if (numbers.length > 0) {
    const nearCurrency = numbers.find((n) => {
      const around = raw.slice(Math.max(0, n.index - 5), n.index + n.raw.length + 7);
      CURRENCY.lastIndex = 0;
      return CURRENCY.test(around);
    });
    amount = (nearCurrency ?? numbers.reduce((a, b) => (b.value > a.value ? b : a))).value;
  }

  // Business name = the leftover words, minus numbers, currency, filler and date words.
  const cleaned = raw.replace(/\d+(?:[.,]\d+)?/g, " ").replace(CURRENCY, " ");
  const businessName = cleaned
    .split(/\s+/)
    .map((w) => w.replace(/^[-־]/, "").trim())
    .filter((w) => w.length > 0 && !FILLER.has(w) && !DATE_WORDS.has(w))
    .map(stripPrefix)
    .filter((w) => w.length > 0 && !FILLER.has(w) && !DATE_WORDS.has(w))
    .join(" ")
    .trim();

  return { amount, businessName, date };
}

export const quickAddService = {
  async add(userId: number, text: string) {
    const { amount, businessName, date } = parseQuickAdd(text);
    if (amount == null || amount <= 0) {
      throw ApiError.badRequest('לא זיהיתי סכום. נסי למשל: "שופרסל 250" או "קניתי בקפה ב-18"');
    }
    if (amount > 9999999999) throw ApiError.badRequest("הסכום גדול מדי");

    const categorize = await buildRuleCategorizer(userId);
    const categoryId = businessName ? categorize(businessName) : null;

    const created = await expensesRepository.create(userId, {
      amount,
      categoryId,
      paymentMethodId: null,
      businessName: businessName || null,
      description: "נוסף בהקלדה מהירה",
      expenseDate: date,
      isRecurring: false,
      source: "manual",
    });

    return {
      expense: { ...created, amount: decimalToNumber(created.amount) },
      parsed: {
        amount,
        businessName,
        categoryId,
        categoryName: created.category?.name ?? null,
        categoryIcon: created.category?.icon ?? null,
      },
    };
  },
};
