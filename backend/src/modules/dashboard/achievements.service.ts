import { prisma } from "../../config/database";
import { monthRange } from "../../utils/date.utils";
import { decimalToNumber, round2 } from "../../utils/money.utils";
import { dashboardRepository } from "./dashboard.repository";
import { spentByCategory } from "./dashboard.service";

/**
 * Light gamification — computed on the fly (no persistence, no migration).
 * Design follows budgeting-UX research: celebrate progress, never shame. Streaks
 * reward staying on target; badges mark savings/consistency milestones. The
 * frontend renders these encouragingly (AchievementsPanel).
 */

export interface Badge {
  key: string;
  icon: string;
  title: string;
  description: string;
  earned: boolean;
  /** 0–100 progress toward earning it (for un-earned, tiered badges). */
  progress?: number;
}

export interface AchievementsResponse {
  streak: {
    months: number;
    onTrackThisMonth: boolean;
    hasTarget: boolean;
    label: string;
  };
  monthsTracked: number;
  earnedCount: number;
  badges: Badge[];
}

async function monthExpense(userId: number, year: number, month: number): Promise<number> {
  const { start, end } = monthRange(year, month);
  const [expenses, credit] = await Promise.all([
    dashboardRepository.sumExpenses(userId, start, end),
    dashboardRepository.sumConfirmedCredit(userId, start, end),
  ]);
  return round2(decimalToNumber(expenses._sum.amount) + decimalToNumber(credit._sum.amount));
}

function tierBadge(
  key: string,
  icon: string,
  title: string,
  value: number,
  tiers: number[],
  unit: (n: number) => string
): Badge {
  const reached = tiers.filter((t) => value >= t);
  const earned = reached.length > 0;
  const next = tiers.find((t) => value < t);
  return {
    key,
    icon,
    title,
    description: earned
      ? `${title} — ${unit(reached[reached.length - 1])} ✓`
      : next
        ? `עוד ${unit(round2(next - value))} עד לתג הראשון`
        : title,
    earned,
    progress: next ? Math.min(100, Math.round((value / next) * 100)) : 100,
  };
}

export async function buildAchievements(
  userId: number,
  year: number,
  month: number
): Promise<AchievementsResponse> {
  const now = new Date();
  const isCurrentMonth = now.getFullYear() === year && now.getMonth() + 1 === month;

  const settings = await prisma.settings.findUnique({ where: { userId } });
  const target = settings?.monthlyTarget != null ? round2(decimalToNumber(settings.monthlyTarget)) : 0;
  const hasTarget = target > 0;

  // ---- Streak: consecutive COMPLETED months at/under the monthly target ----
  let streakMonths = 0;
  if (hasTarget) {
    // Walk backward from the previous month (current month is still in progress).
    let cursor = new Date(year, month - 2, 1); // month is 1-based → month-2 = previous month
    for (let i = 0; i < 24; i++) {
      const spent = await monthExpense(userId, cursor.getFullYear(), cursor.getMonth() + 1);
      if (spent === 0) break; // no data that far back → streak ends
      if (spent > target) break;
      streakMonths++;
      cursor = new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1);
    }
  }
  const thisMonthSpend = await monthExpense(userId, year, month);
  const onTrackThisMonth = hasTarget && thisMonthSpend > 0 && thisMonthSpend <= target;

  const streakLabel = !hasTarget
    ? "הגדירי יעד חודשי כדי להתחיל לצבור רצף 🎯"
    : streakMonths === 0
      ? isCurrentMonth && onTrackThisMonth
        ? "החודש את במסלול — עוד קצת וזה רצף!"
        : "אין עדיין רצף — החודש הזה יכול להיות ההתחלה"
      : `רצף של ${streakMonths} חודשים בתוך היעד 🔥`;

  // ---- Months tracked (consistency) ----
  const [firstExpense, firstCredit] = await Promise.all([
    prisma.expense.findFirst({ where: { userId }, orderBy: { expenseDate: "asc" }, select: { expenseDate: true } }),
    prisma.creditTransaction.findFirst({
      where: { userId, creditImport: { status: "confirmed" } },
      orderBy: { transactionDate: "asc" },
      select: { transactionDate: true },
    }),
  ]);
  const firstDates = [firstExpense?.expenseDate, firstCredit?.transactionDate].filter(Boolean) as Date[];
  let monthsTracked = 0;
  if (firstDates.length > 0) {
    const earliest = new Date(Math.min(...firstDates.map((d) => d.getTime())));
    monthsTracked =
      (now.getFullYear() - earliest.getFullYear()) * 12 + (now.getMonth() - earliest.getMonth()) + 1;
    monthsTracked = Math.max(1, monthsTracked);
  }

  // ---- Savings total ----
  const goals = await prisma.savingsGoal.findMany({ where: { userId } });
  const savedTotal = goals.reduce((sum, g) => sum + decimalToNumber(g.currentAmount), 0);

  // ---- Budget discipline this month ----
  const budgets = await prisma.budget.findMany({ where: { userId, year, month } });
  let overruns = 0;
  if (budgets.length > 0) {
    const spent = await spentByCategory(userId, year, month);
    overruns = budgets.filter((b) => (spent.get(b.categoryId) ?? 0) > decimalToNumber(b.amount)).length;
  }

  // ---- Categorization coverage this month ----
  const { start, end } = monthRange(year, month);
  const [totalExpenses, categorized] = await Promise.all([
    prisma.expense.count({ where: { userId, expenseDate: { gte: start, lt: end } } }),
    prisma.expense.count({
      where: { userId, expenseDate: { gte: start, lt: end }, NOT: { categoryId: null } },
    }),
  ]);
  const categorizedPct = totalExpenses > 0 ? Math.round((categorized / totalExpenses) * 100) : 0;

  const badges: Badge[] = [
    {
      key: "on-target",
      icon: "🎯",
      title: "בתוך היעד",
      description: onTrackThisMonth ? "החודש נשארת בתוך היעד ✓" : "הישארי החודש מתחת ליעד כדי לזכות",
      earned: onTrackThisMonth,
    },
    {
      key: "streak-3",
      icon: "🔥",
      title: "רצף חם",
      description: streakMonths >= 3 ? `${streakMonths} חודשים ברצף בתוך היעד ✓` : "3 חודשים ברצף בתוך היעד",
      earned: streakMonths >= 3,
      progress: Math.min(100, Math.round((streakMonths / 3) * 100)),
    },
    tierBadge("saver", "🐷", "אלופת החיסכון", savedTotal, [1000, 5000, 10000, 25000], (n) =>
      `₪${n.toLocaleString("he-IL", { maximumFractionDigits: 0 })}`
    ),
    tierBadge("consistency", "📅", "עקביות", monthsTracked, [1, 3, 6, 12], (n) => `${n} חודשים`),
    {
      key: "budget-boss",
      icon: "🛡️",
      title: "שומרת התקציב",
      description:
        budgets.length > 0 && overruns === 0
          ? "כל התקציבים בתוך המסגרת ✓"
          : budgets.length === 0
            ? "הגדירי תקציב לקטגוריה כדי לזכות"
            : `${overruns} תקציבים בחריגה — כמעט שם`,
      earned: budgets.length > 0 && overruns === 0,
    },
    {
      key: "organizer",
      icon: "🏷️",
      title: "מסודרת",
      description:
        categorizedPct >= 90
          ? "90%+ מההוצאות מסווגות ✓"
          : totalExpenses === 0
            ? "הוסיפי הוצאות וסווגי אותן"
            : `${categorizedPct}% מההוצאות מסווגות`,
      earned: categorizedPct >= 90,
      progress: categorizedPct,
    },
  ];

  return {
    streak: { months: streakMonths, onTrackThisMonth, hasTarget, label: streakLabel },
    monthsTracked,
    earnedCount: badges.filter((b) => b.earned).length,
    badges,
  };
}
