import { prisma } from "../../config/database";
import { ApiError } from "../../utils/ApiError";
import { decimalToNumber, round2 } from "../../utils/money.utils";
import { CreateSubscriptionBody, UpdateSubscriptionBody } from "./subscriptions.validation";

async function requireSubscription(userId: number, id: number) {
  const subscription = await prisma.subscription.findFirst({ where: { id, userId } });
  if (!subscription) throw ApiError.notFound("המנוי לא נמצא");
  return subscription;
}

export interface SubscriptionCandidate {
  name: string;
  avgAmount: number;
  months: number;
  lastDate: string;
  nextBillingDate: string;
  confidence: "high" | "medium";
  reason: string;
}

/** Next monthly billing date: same day-of-month as the last charge, next month. */
function nextMonthlyDate(last: Date): Date {
  const year = last.getUTCFullYear();
  const month = last.getUTCMonth(); // 0-based; +1 gives next month
  const daysInNext = new Date(Date.UTC(year, month + 2, 0)).getUTCDate();
  const day = Math.min(last.getUTCDate(), daysInNext);
  return new Date(Date.UTC(year, month + 1, day));
}

export const subscriptionsService = {
  async list(userId: number) {
    const items = await prisma.subscription.findMany({
      where: { userId },
      orderBy: [{ status: "asc" }, { billingDate: "asc" }],
    });
    const active = items.filter((item) => item.status === "active");
    const monthlyTotal = active.reduce(
      (sum, item) => sum + (item.frequency === "yearly" ? Number(item.amount) / 12 : Number(item.amount)),
      0
    );
    // The yearly figure is what actually changes behaviour — a 60 ₪/month
    // subscription is 720 ₪ a year and nobody thinks of it that way. It is
    // computed here rather than as `monthlyTotal * 12` in the UI, so the
    // monthly/yearly normalisation rule stays in one place (CLAUDE.md §4).
    const annualTotal = active.reduce(
      (sum, item) => sum + (item.frequency === "yearly" ? Number(item.amount) : Number(item.amount) * 12),
      0
    );
    return {
      items,
      monthlyTotal: Math.round(monthlyTotal * 100) / 100,
      annualTotal: Math.round(annualTotal * 100) / 100,
      activeCount: active.length,
    };
  },

  /**
   * Likely subscriptions from confirmed credit transactions. Strong signal:
   * הוראת קבע across ≥2 months. Weak: a steady monthly amount across ≥3 months.
   * Groceries are excluded — many charges a month, at varying amounts.
   */
  async detectCandidates(userId: number): Promise<SubscriptionCandidate[]> {
    const [transactions, existing] = await Promise.all([
      prisma.creditTransaction.findMany({
        where: {
          userId,
          transactionType: { in: ["standing_order", "regular"] },
          amount: { gt: 0 },
          creditImport: { status: "confirmed" },
        },
        select: { businessName: true, amount: true, billingDate: true, transactionType: true },
      }),
      prisma.subscription.findMany({ where: { userId }, select: { name: true } }),
    ]);

    const existingNames = existing.map((s) => s.name.toLowerCase());

    // Group by business name
    const groups = new Map<
      string,
      { amounts: number[]; months: Set<string>; last: Date; standingOrder: number; count: number }
    >();
    for (const tx of transactions) {
      const g = groups.get(tx.businessName) ?? {
        amounts: [],
        months: new Set<string>(),
        last: tx.billingDate,
        standingOrder: 0,
        count: 0,
      };
      const amount = decimalToNumber(tx.amount);
      g.amounts.push(amount);
      g.months.add(`${tx.billingDate.getUTCFullYear()}-${tx.billingDate.getUTCMonth()}`);
      if (tx.billingDate.getTime() > g.last.getTime()) g.last = tx.billingDate;
      if (tx.transactionType === "standing_order") g.standingOrder += 1;
      g.count += 1;
      groups.set(tx.businessName, g);
    }

    const candidates: SubscriptionCandidate[] = [];
    for (const [name, g] of groups) {
      // Skip if already a subscription (name overlap in either direction)
      const lower = name.toLowerCase();
      if (existingNames.some((n) => lower.includes(n) || n.includes(lower))) continue;

      const months = g.months.size;
      const avg = round2(g.amounts.reduce((s, a) => s + a, 0) / g.amounts.length);
      const min = Math.min(...g.amounts);
      const max = Math.max(...g.amounts);
      const chargesPerMonth = g.count / months;
      const isStandingOrder = g.standingOrder / g.count >= 0.5;

      let confidence: "high" | "medium" | null = null;
      let reason = "";
      if (isStandingOrder && months >= 2) {
        confidence = "high";
        reason = `הוראת קבע שחוזרת ${months} חודשים`;
      } else if (months >= 3 && chargesPerMonth <= 1.4 && min > 0 && max / min <= 1.25) {
        confidence = "medium";
        reason = `חיוב קבוע בסכום דומה ${months} חודשים ברציפות`;
      }
      if (!confidence) continue;

      candidates.push({
        name,
        avgAmount: avg,
        months,
        lastDate: g.last.toISOString(),
        nextBillingDate: nextMonthlyDate(g.last).toISOString(),
        confidence,
        reason,
      });
    }

    // High confidence first, then by amount
    const order = { high: 0, medium: 1 };
    return candidates.sort((a, b) => order[a.confidence] - order[b.confidence] || b.avgAmount - a.avgAmount);
  },

  create(userId: number, body: CreateSubscriptionBody) {
    return prisma.subscription.create({
      data: {
        userId,
        name: body.name,
        amount: body.amount,
        billingDate: body.billingDate,
        frequency: body.frequency,
        status: body.status ?? "active",
      },
    });
  },

  async update(userId: number, id: number, body: UpdateSubscriptionBody) {
    await requireSubscription(userId, id);
    return prisma.subscription.update({ where: { id }, data: body });
  },

  async remove(userId: number, id: number) {
    await requireSubscription(userId, id);
    await prisma.subscription.delete({ where: { id } });
  },
};
