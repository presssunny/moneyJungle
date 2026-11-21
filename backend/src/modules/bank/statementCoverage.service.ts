import { prisma } from "../../config/database";
import { businessDate } from "../../utils/date.utils";
import type { MonthCoverage } from "../../types/money.types";

export type { MonthCoverage };

export interface StatementRange {
  accountId: number;
  /** First and last row dates — a lower bound on what the statement covered. */
  from: string;
  to: string;
}

// A month's first/last 3 days, or a gap of up to 3 days between statements, is a weekend or a quiet day.
const EDGE_SLACK_DAYS = 3;
const DAY_MS = 86_400_000;

const ms = (day: string) => Date.parse(`${day}T00:00:00.000Z`);
const day = (time: number) => new Date(time).toISOString().slice(0, 10);

function merged(ranges: StatementRange[]): Array<[number, number]> {
  const sorted = ranges.map((r): [number, number] => [ms(r.from), ms(r.to)]).sort((a, b) => a[0] - b[0]);
  const out: Array<[number, number]> = [];
  for (const [from, to] of sorted) {
    const last = out.at(-1);
    if (last && from <= last[1] + (EDGE_SLACK_DAYS + 1) * DAY_MS) last[1] = Math.max(last[1], to);
    else out.push([from, to]);
  }
  return out;
}

export function monthCoverageFrom(ranges: StatementRange[], monthKey: string, today: string): MonthCoverage {
  const [year, month] = monthKey.split("-").map(Number);
  const start = Date.UTC(year!, month! - 1, 1);
  const end = Date.UTC(year!, month!, 0);
  const current = today.slice(0, 7) === monthKey;
  const accounts = [...new Set(ranges.map((r) => r.accountId))];

  let touched = false;
  let full = true;
  let from = Infinity;
  // The current month is covered up to where EVERY account is continuous from day 1; a past one up to its last row.
  let to = current ? Infinity : -Infinity;
  for (const accountId of accounts) {
    const segments = merged(ranges.filter((r) => r.accountId === accountId));
    // An account whose statements reach past the month on both sides "touches" it, even through a gap.
    if (segments.at(-1)![1] < start || segments[0]![0] > end) continue;
    touched = true;
    const inMonth = segments.filter(([a, b]) => b >= start && a <= end);
    if (!inMonth.length) { full = false; continue; }
    const fromStart = inMonth.find(([a]) => a <= start + EDGE_SLACK_DAYS * DAY_MS);
    if (!fromStart || (!current && fromStart[1] < end - EDGE_SLACK_DAYS * DAY_MS)) full = false;
    from = Math.min(from, Math.max(start, inMonth[0]![0]));
    if (!current) to = Math.max(to, inMonth.at(-1)![1]);
    else if (fromStart) to = Math.min(to, fromStart[1]);
  }
  if (!touched) return { state: "unknown" };
  const span = { from: from === Infinity ? null : day(from), to: Number.isFinite(to) ? day(Math.min(to, end)) : null };
  if (!full || span.from === null || span.to === null) return { state: "partial", ...span };
  return current ? { state: "to_date", from: day(start), to: span.to } : { state: "complete", from: day(start), to: day(end) };
}

/** Coverage of each month by the household's bank statements and approved syncs. */
export async function statementCoverage(userId: number, monthKeys: string[]): Promise<Map<string, MonthCoverage>> {
  const statements = await prisma.bankStatementImport.findMany({ where: { userId }, select: { bankAccountId: true, coverageFrom: true, coverageTo: true } });
  const ranges = statements.map((s) => ({ accountId: s.bankAccountId, from: s.coverageFrom.toISOString().slice(0, 10), to: s.coverageTo.toISOString().slice(0, 10) }));
  const today = businessDate();
  return new Map(monthKeys.map((key) => [key, monthCoverageFrom(ranges, key, today)]));
}
