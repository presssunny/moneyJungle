import { prisma } from "../../config/database";
import { monthRange } from "../../utils/date.utils";
import { decimalToNumber, percent, round2 } from "../../utils/money.utils";
import { computeLoan } from "../loans/loanCalculator.service";
import { loansRepository } from "../loans/loans.repository";
import { dashboardRepository } from "./dashboard.repository";
import { spentByCategory } from "./dashboard.service";

export interface Insight {
  icon: string;
  text: string;
  tone: "good" | "info" | "warning" | "bad";
}

export interface InsightsResponse {
  healthScore: number | null;
  scoreLabel: string;
  safePerDay: number | null;
  daysLeft: number;
  projection: {
    dailyBurn: number;
    projectedExpenses: number;
    projectedBalance: number;
  } | null;
  insights: Insight[];
}

function formatILS(amount: number): string {
  return `₪${amount.toLocaleString("he-IL", { maximumFractionDigits: 0 })}`;
}

async function totals(userId: number, year: number, month: number) {
  const { start, end } = monthRange(year, month);
  const [incomes, expenses, credit] = await Promise.all([
    dashboardRepository.sumIncomes(userId, start, end),
    dashboardRepository.sumExpenses(userId, start, end),
    dashboardRepository.sumConfirmedCredit(userId, start, end),
  ]);
  const incomeTotal = round2(decimalToNumber(incomes._sum.amount));
  const expenseTotal = round2(decimalToNumber(expenses._sum.amount) + decimalToNumber(credit._sum.amount));
  return { incomeTotal, expenseTotal };
}

function scoreLabel(score: number): string {
  if (score >= 80) return "מצוין 🚀";
  if (score >= 60) return "טוב 👍";
  if (score >= 40) return "דורש תשומת לב ⚠️";
  return "מצב חירום 🚨";
}

export async function buildInsights(userId: number, year: number, month: number): Promise<InsightsResponse> {
  const now = new Date();
  const isCurrentMonth = now.getFullYear() === year && now.getMonth() + 1 === month;
  const daysInMonth = new Date(year, month, 0).getDate();
  const dayOfMonth = isCurrentMonth ? now.getDate() : daysInMonth;
  const daysLeft = Math.max(0, daysInMonth - dayOfMonth);

  const prevDate = new Date(year, month - 2, 1);
  const [current, previous] = await Promise.all([
    totals(userId, year, month),
    totals(userId, prevDate.getFullYear(), prevDate.getMonth() + 1),
  ]);
  const balance = round2(current.incomeTotal - current.expenseTotal);

  const insights: Insight[] = [];

  // No data yet → no score, friendly nudge
  if (current.incomeTotal === 0 && current.expenseTotal === 0) {
    return {
      healthScore: null,
      scoreLabel: "אין עדיין נתונים החודש",
      safePerDay: null,
      daysLeft,
      projection: null,
      insights: [
        { icon: "✨", text: "הוסיפי הכנסה והוצאות (או ייבאי אקסל) כדי לקבל ציון בריאות פיננסית ותובנות", tone: "info" },
      ],
    };
  }

  // ---- Projection & safe-to-spend (current month only) ----
  const dailyBurn = dayOfMonth > 0 ? round2(current.expenseTotal / dayOfMonth) : 0;
  const projection = isCurrentMonth
    ? {
        dailyBurn,
        projectedExpenses: round2(current.expenseTotal + dailyBurn * daysLeft),
        projectedBalance: round2(current.incomeTotal - (current.expenseTotal + dailyBurn * daysLeft)),
      }
    : null;
  const safePerDay =
    isCurrentMonth && daysLeft > 0 && balance > 0 ? Math.floor(balance / daysLeft) : isCurrentMonth ? 0 : null;

  // ---- Health score ----
  let score = 0;

  // Spending ratio — up to 50 pts (≤70% of income = full marks, ≥110% = none)
  if (current.incomeTotal > 0) {
    const ratio = current.expenseTotal / current.incomeTotal;
    score += Math.round(50 * Math.min(1, Math.max(0, (1.1 - ratio) / 0.4)));
  } else {
    score += 10; // expenses with no recorded income
  }

  // Budget compliance — up to 20 pts
  const budgets = await prisma.budget.findMany({ where: { userId, year, month }, include: { category: true } });
  let overruns = 0;
  if (budgets.length > 0) {
    const spent = await spentByCategory(userId, year, month);
    overruns = budgets.filter((b) => (spent.get(b.categoryId) ?? 0) > decimalToNumber(b.amount)).length;
    score += Math.round(20 * (1 - overruns / budgets.length));
  } else {
    score += 12;
  }

  // Loans — up to 15 pts
  const loans = await loansRepository.findActive(userId);
  const loanComputed = loans.map((loan) => ({
    loan,
    computed: computeLoan({
      currentBalance: decimalToNumber(loan.currentBalance),
      annualInterestRate: decimalToNumber(loan.annualInterestRate),
      monthlyPayment: decimalToNumber(loan.monthlyPayment),
    }),
  }));
  const neverEnding = loanComputed.filter((l) => l.computed.remainingMonths === null);
  const expensive = loanComputed.filter((l) => l.computed.isExpensive);
  if (neverEnding.length > 0) score += 0;
  else if (expensive.length > 0) score += 7;
  else score += 15;

  // Savings habit — up to 15 pts
  const goals = await prisma.savingsGoal.findMany({ where: { userId } });
  const savedTotal = goals.reduce((sum, g) => sum + decimalToNumber(g.currentAmount), 0);
  if (savedTotal > 0) score += 15;
  else if (goals.length > 0) score += 8;
  else score += 5;

  score = Math.max(0, Math.min(100, score));

  // ---- Insights ----

  // Biggest category jump vs last month
  const [curSpent, prevSpent] = await Promise.all([
    spentByCategory(userId, year, month),
    spentByCategory(userId, prevDate.getFullYear(), prevDate.getMonth() + 1),
  ]);
  if (prevSpent.size > 0) {
    let jumpName = "";
    let jumpDelta = 0;
    const categories = await prisma.category.findMany({ where: { OR: [{ userId }, { userId: null }] } });
    const nameById = new Map(categories.map((c) => [c.id, `${c.icon ?? ""} ${c.name}`]));
    for (const [categoryId, value] of curSpent) {
      if (categoryId === null) continue;
      const delta = value - (prevSpent.get(categoryId) ?? 0);
      if (delta > jumpDelta) {
        jumpDelta = delta;
        jumpName = nameById.get(categoryId) ?? "";
      }
    }
    if (jumpName && jumpDelta >= 100) {
      insights.push({
        icon: "📈",
        text: `${jumpName}: ${formatILS(jumpDelta)} יותר מהחודש הקודם`,
        tone: "warning",
      });
    }
  }

  // Month-over-month total change
  if (previous.expenseTotal > 0) {
    const diff = round2(current.expenseTotal - previous.expenseTotal);
    if (Math.abs(diff) >= 200) {
      insights.push({
        icon: diff < 0 ? "🎉" : "💸",
        text:
          diff < 0
            ? `הוצאת ${formatILS(-diff)} פחות מהחודש הקודם — כל הכבוד!`
            : `ההוצאות גבוהות ב־${formatILS(diff)} מהחודש הקודם`,
        tone: diff < 0 ? "good" : "warning",
      });
    }
  }

  // Subscriptions yearly cost
  const subscriptions = await prisma.subscription.findMany({ where: { userId, status: "active" } });
  if (subscriptions.length > 0) {
    const monthly = subscriptions.reduce(
      (sum, s) => sum + (s.frequency === "yearly" ? decimalToNumber(s.amount) / 12 : decimalToNumber(s.amount)),
      0
    );
    insights.push({
      icon: "📺",
      text: `${subscriptions.length} מנויים פעילים עולים ${formatILS(round2(monthly * 12))} בשנה`,
      tone: "info",
    });
  }

  // Interest burden
  const monthlyInterest = loanComputed.reduce((sum, l) => sum + l.computed.monthlyInterestPayment, 0);
  if (monthlyInterest >= 100) {
    insights.push({
      icon: "🏦",
      text: `הריביות על ההלוואות אוכלות ${formatILS(round2(monthlyInterest))} בחודש (${formatILS(round2(monthlyInterest * 12))} בשנה)`,
      tone: "warning",
    });
  }

  // Uncategorized expenses
  const { start, end } = monthRange(year, month);
  const uncategorized = await prisma.expense.count({
    where: { userId, categoryId: null, expenseDate: { gte: start, lt: end } },
  });
  if (uncategorized > 0) {
    insights.push({
      icon: "🏷️",
      text: `${uncategorized} הוצאות בלי קטגוריה — סיווג ישפר את הדוחות`,
      tone: "info",
    });
  }

  // Budget overruns headline
  if (overruns > 0) {
    insights.push({
      icon: "🎯",
      text: `${overruns} מתוך ${budgets.length} תקציבים בחריגה החודש`,
      tone: "bad",
    });
  }

  // Positive reinforcement when everything is calm
  if (insights.length === 0) {
    insights.push({
      icon: "😌",
      text: balance >= 0 ? "החודש נראה מאוזן — ממשיכים ככה" : "אין תובנות מיוחדות החודש",
      tone: "good",
    });
  }

  return {
    healthScore: score,
    scoreLabel: scoreLabel(score),
    safePerDay,
    daysLeft,
    projection,
    insights: insights.slice(0, 5),
  };
}
