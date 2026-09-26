import type { QuestionAnswer, QuestionFact } from "../../types/householdAssistant.types";
import { businessDate } from "../../utils/date.utils";
import { formatILS } from "../../utils/money.utils";
import { dashboardRepository } from "../dashboard/dashboard.repository";
import { monthTotals, spentByCategory } from "../dashboard/dashboard.service";
import { documentBreakdown, type DocumentBreakdown } from "../documents/documentBreakdown.service";
import { upcomingCommitments } from "../journey/actions.service";
import { financialStatus } from "../journey/coverage.service";
import { financialMetric } from "../journey/metrics.service";
import { loansService } from "../loans/loans.service";
import { savingsService } from "../savings/savings.service";
import { HEBREW_MONTHS, type MonthParam, type RoutedQuestion } from "./questions";

type Answer = Omit<QuestionAnswer, "mode" | "examples">;

const money = (amount: number) => formatILS(amount, { exact: true });

const fact = (label: string, value: number | null, missing = "לא זמין"): QuestionFact =>
  ({ label, value, display: value === null ? missing : money(value) });

function resolveMonth(param: MonthParam, today = businessDate()) {
  const [year, month] = today.split("-").map(Number);
  if (param === "current") return { year, month };
  if (param === "previous") return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
  const [y, m] = param.split("-").map(Number);
  return { year: y, month: m };
}
const monthName = ({ year, month }: { year: number; month: number }) => `${HEBREW_MONTHS[month - 1]} ${year}`;
const monthKey = ({ year, month }: { year: number; month: number }) => `${year}-${String(month).padStart(2, "0")}`;

// A net figure hides an unusual charge offset by a credit, so the gross amounts lead.
function interestSentence(breakdown: DocumentBreakdown, coverage: string) {
  const interest = breakdown.interest;
  if (!interest) return `לא נמצאה ריבית בקובץ ${breakdown.fileName}.`;
  if (interest.kind === "planned") {
    return `לפי הלוח מתוכננת ריבית של ${money(interest.amount)} לאורך ${interest.payments} תשלומים. זה תכנון, לא ריבית שנגבתה; בהלוואה בריבית מותנית ייתכן שלא תיגבה. הריבית בפועל — רק מדף הבנק.`;
  }
  return `בקובץ ${breakdown.fileName}${coverage} נגבתה ריבית של ${money(interest.charged)}, זוכו ${money(interest.credited)}, ובנטו ${money(interest.net)}.`;
}

/** Every figure comes from the service that already owns it; this only words the result. */
export async function answerQuestion(userId: number, routed: RoutedQuestion, documentId?: number): Promise<Answer> {
  switch (routed.intent) {
    case "month_totals": {
      const period = resolveMonth(routed.month);
      const totals = await monthTotals(userId, period.year, period.month);
      const left = totals.balance;
      return {
        intent: routed.intent,
        answer: `ב${monthName(period)} נכנסו ${money(totals.incomeTotal)} ויצאו ${money(totals.expenseTotal)}, כלומר ${left >= 0 ? "נשארו" : "חסרו"} ${money(Math.abs(left))}.`,
        facts: [fact("נכנס", totals.incomeTotal), fact("יצא", totals.expenseTotal), fact("מתוכם באשראי", totals.creditTotal), fact("נשאר", left)],
        links: [{ label: "התנועות של החודש", to: `/transactions?month=${monthKey(period)}` }],
        limitations: ["זה הפרש בין הכנסות להוצאות שנרשמו — לא יתרת הבנק ולא כסף פנוי", "קרן הלוואה, העברות בין חשבונות ואשראי מתגלגל אינם הוצאה", "אשראי נספר לפי חודש העסקה בדוח, לא לפי מועד הירידה מהבנק"],
      };
    }
    case "category_spend": {
      const period = resolveMonth(routed.month);
      const wanted = routed.category.trim();
      const [spent, categories] = await Promise.all([spentByCategory(userId, period.year, period.month), dashboardRepository.categories(userId)]);
      const matches = categories.filter((c) => c.name.includes(wanted) || wanted.includes(c.name));
      if (!matches.length) {
        return { intent: routed.intent, answer: `לא מצאתי קטגוריה בשם "${wanted}".`, facts: [], links: [{ label: "הקטגוריות שלך", to: "/settings?tab=categories" }], limitations: [] };
      }
      const amount = Math.round(matches.reduce((sum, c) => sum + (spent.get(c.id) ?? 0), 0) * 100) / 100;
      const names = matches.map((c) => c.name).join(", ");
      return {
        intent: routed.intent,
        answer: `ב${monthName(period)} יצאו ${money(amount)} בקטגוריה ${names}.`,
        facts: matches.map((c) => fact(c.name, spent.get(c.id) ?? 0)),
        links: [{ label: "התנועות בקטגוריה", to: `/transactions?month=${monthKey(period)}&tab=expenses&category=${matches[0].id}` }],
        limitations: ["תנועות שלא סווגו לקטגוריה אינן נכללות"],
      };
    }
    case "allowance": {
      const state = await financialStatus(userId);
      const { amount, state: availability } = state.allowance;
      return {
        intent: routed.intent,
        answer: amount === null
          ? "עדיין אי אפשר לחשב כמה מותר להוציא היום, כי חסר מידע."
          : `לפי המידע הרשום, אפשר להוציא היום עד ${money(amount)}.`,
        facts: [fact("מותר להוציא היום", amount, "חסר מידע")],
        links: [{ label: "איך זה מחושב", to: "/" }],
        limitations: availability === "unavailable" ? state.blockers.slice(0, 3) : state.allowance.assumptions.slice(0, 2),
      };
    }
    case "upcoming": {
      const state = await financialStatus(userId);
      const events = upcomingCommitments(state).slice(0, 5);
      return {
        intent: routed.intent,
        answer: events.length ? `ב־7 הימים הקרובים צפויים ${events.length} חיובים.` : "לא נמצאו חיובים צפויים ב־7 הימים הקרובים.",
        facts: events.map((e) => ({ label: `${e.date} · ${e.name}`, value: e.amount, display: e.amount === null ? "סכום לא ידוע" : money(e.amount) })),
        links: [{ label: "כל ההתחייבויות", to: "/commitments" }],
        limitations: ["רק תשלומים קבועים, הלוואות, חיובי אשראי ותזכורות שרשומים במערכת"],
      };
    }
    case "loans": {
      const { summary } = await loansService.list(userId);
      return {
        intent: routed.intent,
        answer: summary.activeCount
          ? `יש ${summary.activeCount} הלוואות פעילות. נשארו להחזיר ${money(summary.totalBalance)}, בתשלום חודשי של ${money(summary.monthlyPayment)}.`
          : "אין הלוואות פעילות רשומות.",
        facts: [fact("יתרה להחזר", summary.totalBalance), fact("תשלום חודשי", summary.monthlyPayment), fact("ריבית חודשית משוערת", summary.monthlyInterest)],
        links: [{ label: "ההלוואות", to: "/accounts?tab=loans" }],
        limitations: ["היתרה היא האחרונה שנרשמה להלוואה, ומתעדכנת בייבוא לוח סילוקין או בעריכה", "הריבית המשוערת מחושבת מהיתרה ומשיעור הריבית; בהלוואה בריבית מותנית היא עלולה לא להיגבות. הריבית בפועל — מדף הבנק"],
      };
    }
    case "goals": {
      const { goals, summary } = await savingsService.list(userId);
      return {
        intent: routed.intent,
        answer: !goals.length ? "עדיין לא הוגדרו יעדים."
          : !summary.setAsideCount ? "אין יעדי חיסכון; יש רק יעדי סילוק הלוואה."
          : `ביעדי החיסכון נרשמו ${money(summary.savedTotal)} מתוך ${money(summary.targetTotal)}.`,
        facts: goals.map((g) => ({ label: g.goalName, value: g.progress.percent, display: `${g.progress.percent}%` })),
        links: [{ label: "היעדים", to: "/accounts?tab=savings" }],
        limitations: ["יעד סילוק הלוואה אינו חיסכון ולכן אינו נספר בסכום החיסכון"],
      };
    }
    case "net_worth": {
      const today = businessDate();
      const metric = await financialMetric(userId, "netWorth", today.slice(0, 7));
      return {
        intent: routed.intent,
        answer: metric.value === null ? "עדיין אי אפשר לחשב שווי נטו, כי חסר מידע." : `השווי הנטו לפי המידע הרשום הוא ${money(metric.value)}.`,
        facts: [fact("שווי נטו", metric.value, "חסר מידע")],
        links: [{ label: "נכסים וחובות", to: "/accounts" }],
        limitations: metric.missingData.slice(0, 3),
      };
    }
    case "document_summary":
    case "document_interest": {
      const breakdown = await documentBreakdown(userId, documentId!);
      const coverage = breakdown.coverageFrom ? ` (${breakdown.coverageFrom} עד ${breakdown.coverageTo})` : "";
      if (!breakdown.available) {
        return { intent: routed.intent, answer: breakdown.note ?? "אין פירוט זמין לקובץ הזה.", facts: [], links: [{ label: "המסמך", to: "/data" }], limitations: [] };
      }
      const interestKeys = new Set(["financing_charge", "financing_credit", "interest"]);
      const lines = routed.intent === "document_interest" ? breakdown.lines.filter((l) => interestKeys.has(l.key)) : breakdown.lines;
      return {
        intent: routed.intent,
        answer: routed.intent === "document_interest" ? interestSentence(breakdown, coverage)
          : `הקובץ ${breakdown.fileName}${coverage} יצר ${breakdown.lines.reduce((n, l) => n + l.count, 0)} רשומות, לפי המשמעות שלהן:`,
        facts: lines.map((l) => ({ label: `${l.label} (${l.count})`, value: l.amount, display: money(l.amount) })),
        links: [{ label: "המסמך ומה שזוהה בו", to: "/data" }],
        limitations: breakdown.note ? [breakdown.note] : [],
      };
    }
  }
}
