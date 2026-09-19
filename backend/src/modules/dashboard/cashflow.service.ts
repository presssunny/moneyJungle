import { prisma } from "../../config/database";
import { decimalToNumber, round2 } from "../../utils/money.utils";
import { businessDate } from "../journey/journey.utils";

/**
 * Forward-looking cash-flow: projects dated obligations (recurring payments,
 * subscriptions, loan installments, reminders) across the next N days so the user
 * can see pressure BEFORE it arrives — "on the 15th three charges land together".
 * All computed on the fly from existing data; no new tables.
 */

export type UpcomingKind = "recurring" | "subscription" | "loan" | "reminder";

export interface UpcomingEvent {
  key?: string;
  date: string; // ISO date
  kind: UpcomingKind;
  name: string;
  amount: number;
  amountKnown?: boolean;
  icon: string;
}

export interface UpcomingResponse {
  windowDays: number;
  from: string;
  to: string;
  total: number;
  events: UpcomingEvent[];
  heaviestDay: { date: string; total: number; count: number } | null;
}

const KIND_ICON: Record<UpcomingKind, string> = {
  recurring: "🔁",
  subscription: "📺",
  loan: "📉",
  reminder: "🔔",
};

function businessDayStart(): Date {
  return new Date(businessDate());
}

// includeOverdue must keep surfacing genuinely relevant unresolved debt without
// regenerating an unbounded number of past occurrences for an old recurring
// payment or loan anchor (a stale nextPaymentDate can otherwise sit years in
// the past). A decision already recorded on an old occurrence keeps working
// regardless of this window — commitments.service.ts re-injects it from its
// own persisted snapshot. This bound only limits how far back an occurrence
// that was NEVER decided is still auto-generated for review.
const HISTORICAL_LOOKBACK_DAYS = 366;
function historicalFloor(from: Date): Date {
  const floor = new Date(from);
  floor.setUTCDate(floor.getUTCDate() - HISTORICAL_LOOKBACK_DAYS);
  return floor;
}
function laterOf(a: Date, b: Date): Date {
  return a > b ? a : b;
}

/** Monthly occurrences on the anchor's day-of-month (clamped) within [from, to]. */
function monthlyOccurrences(anchor: Date, from: Date, to: Date): Date[] {
  const day = anchor.getUTCDate();
  const res: Date[] = [];
  let y = from.getUTCFullYear();
  let m = from.getUTCMonth();
  while (new Date(Date.UTC(y, m, 1)) <= to) {
    const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const d = new Date(Date.UTC(y, m, Math.min(day, daysInMonth)));
    if (d >= from && d >= anchor && d <= to) res.push(d);
    m += 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
  }
  return res;
}

/** Yearly occurrence(s) on the anchor's month+day within [from, to]. */
function yearlyOccurrences(anchor: Date, from: Date, to: Date): Date[] {
  const res: Date[] = [];
  for (let y = from.getUTCFullYear(); y <= to.getUTCFullYear() + 1; y++) {
    const lastDay = new Date(Date.UTC(y, anchor.getUTCMonth() + 1, 0)).getUTCDate();
    const d = new Date(Date.UTC(y, anchor.getUTCMonth(), Math.min(anchor.getUTCDate(), lastDay)));
    if (d >= from && d >= anchor && d <= to) res.push(d);
  }
  return res;
}

/** Weekly occurrences stepping 7 days from the anchor's weekday within [from, to]. */
function weeklyOccurrences(anchor: Date, from: Date, to: Date): Date[] {
  const res: Date[] = [];
  const d = new Date(anchor);
  if (d < from) d.setUTCDate(d.getUTCDate() + Math.ceil((from.getTime() - d.getTime()) / (7 * 86400000)) * 7);
  while (d <= to) {
    res.push(new Date(d));
    d.setUTCDate(d.getUTCDate() + 7);
  }
  return res;
}

// Journey review includes historical occurrences because a past date alone is
// not payment evidence. Dashboard callers keep the forward-only default.
export async function buildUpcoming(userId: number, windowDays: number, anchor = businessDayStart(), includeOverdue = false): Promise<UpcomingResponse> {
  const from = anchor;
  const to = new Date(from);
  to.setUTCDate(to.getUTCDate() + windowDays);

  const historicalGte = includeOverdue ? historicalFloor(from) : from;
  const [recurrings, subscriptions, loans, reminders] = await Promise.all([
    prisma.recurringPayment.findMany({ where: { userId } }),
    prisma.subscription.findMany({ where: { userId, status: "active" } }),
    prisma.loan.findMany({ where: { userId, status: { in: ["active", "overdue"] } }, include: { schedule: { where: { paymentDate: { gte: historicalGte, lte: to } }, orderBy: { paymentDate: "asc" } } } }),
    prisma.reminder.findMany({
      where: { userId, isActive: true, eventDate: { gte: historicalGte, lte: to } },
    }),
  ]);

  const events: UpcomingEvent[] = [];

  for (const r of recurrings) {
    const amount = decimalToNumber(r.amount);
    const anchor = new Date(r.nextPaymentDate);
    const occurrenceFrom = includeOverdue ? laterOf(anchor, historicalFloor(from)) : from;
    const dates =
      r.frequency === "weekly"
        ? weeklyOccurrences(anchor, occurrenceFrom, to)
        : r.frequency === "yearly"
          ? yearlyOccurrences(anchor, occurrenceFrom, to)
          : monthlyOccurrences(anchor, occurrenceFrom, to);
    for (const d of dates) {
      events.push({ key: `recurring:${r.id}:${d.toISOString().slice(0, 10)}`, date: d.toISOString(), kind: "recurring", name: r.name, amount, icon: KIND_ICON.recurring });
    }
  }

  for (const s of subscriptions) {
    const amount = decimalToNumber(s.amount);
    const anchor = new Date(s.billingDate);
    const occurrenceFrom = includeOverdue ? laterOf(anchor, historicalFloor(from)) : from;
    const dates = s.frequency === "yearly" ? yearlyOccurrences(anchor, occurrenceFrom, to) : monthlyOccurrences(anchor, occurrenceFrom, to);
    for (const d of dates) {
      events.push({ key: `subscription:${s.id}:${d.toISOString().slice(0, 10)}`, date: d.toISOString(), kind: "subscription", name: s.name, amount, icon: KIND_ICON.subscription });
    }
  }

  for (const loan of loans) {
    // Bank schedules carry final/variable payments; repeating monthlyPayment would invent extra debt.
    if (loan.scheduleSource === "bank_file") {
      for (const entry of loan.schedule) {
        events.push({ key: `loan:${loan.id}:${entry.paymentDate.toISOString().slice(0, 10)}`, date: entry.paymentDate.toISOString(), kind: "loan", name: loan.loanName,
          amount: decimalToNumber(entry.total), icon: KIND_ICON.loan });
      }
      continue;
    }
    const amount = decimalToNumber(loan.monthlyPayment);
    if (amount <= 0) continue;
    const balance = decimalToNumber(loan.currentBalance);
    if (balance <= 0) continue;
    const endDate = loan.endDate ? new Date(loan.endDate) : null;
    const start = new Date(loan.startDate);
    const dates = monthlyOccurrences(start, includeOverdue ? laterOf(start, historicalFloor(from)) : from, to);
    for (const d of dates) {
      if (endDate && d > endDate) continue;
      events.push({
        key: `loan:${loan.id}:${d.toISOString().slice(0, 10)}`,
        date: d.toISOString(),
        kind: "loan",
        name: loan.loanName,
        amount,
        icon: KIND_ICON.loan,
      });
    }
  }

  for (const rem of reminders) {
    if (includeOverdue && rem.estimatedAmount === null && rem.type !== "expected_expense") continue;
    events.push({
      key: `reminder:${rem.id}:${new Date(rem.eventDate).toISOString().slice(0, 10)}`,
      date: new Date(rem.eventDate).toISOString(),
      kind: "reminder",
      name: rem.title,
      amount: rem.estimatedAmount != null ? decimalToNumber(rem.estimatedAmount) : 0,
      amountKnown: rem.estimatedAmount != null,
      icon: rem.icon || KIND_ICON.reminder,
    });
  }

  events.sort((a, b) => a.date.localeCompare(b.date));

  // Heaviest single day — the "pressure" moment worth warning about.
  const byDay = new Map<string, { total: number; count: number }>();
  for (const e of events) {
    const key = e.date.slice(0, 10);
    const agg = byDay.get(key) ?? { total: 0, count: 0 };
    agg.total += e.amount;
    agg.count += 1;
    byDay.set(key, agg);
  }
  let heaviestDay: UpcomingResponse["heaviestDay"] = null;
  for (const [date, agg] of byDay) {
    if (!heaviestDay || agg.total > heaviestDay.total) {
      heaviestDay = { date: `${date}T00:00:00.000Z`, total: round2(agg.total), count: agg.count };
    }
  }

  return {
    windowDays,
    from: from.toISOString(),
    to: to.toISOString(),
    total: round2(events.reduce((sum, e) => sum + e.amount, 0)),
    events,
    heaviestDay,
  };
}
