import { round2 } from "./money.utils";

/** A month narrowed by optional inclusive from/to days; never wider than the month. */
export function ledgerRange(start: Date, end: Date, from?: string, to?: string) {
  const lower = from && new Date(from) > start ? new Date(from) : start;
  const upperExclusive = to ? new Date(new Date(to).getTime() + 86400000) : end;
  return { gte: lower, lt: upperExclusive < end ? upperExclusive : end };
}

export interface LedgerKey { source: string; id: number; date: Date; amount: number }

/** Newest first, then by id, so a page boundary never reshuffles between requests. */
export function orderLedgerKeys(keys: LedgerKey[]) {
  return [...keys].sort((a, b) => b.date.getTime() - a.date.getTime() || b.id - a.id || a.source.localeCompare(b.source));
}

/** The filtered rows' own count and sum — a filter result, never a monthly total. */
export function filteredSummary(keys: LedgerKey[]) {
  return { filteredCount: keys.length, filteredTotal: round2(keys.reduce((sum, key) => sum + Math.round(key.amount * 100), 0) / 100) };
}

/** A page past the end — the last row deleted, or a stale link — is the last page, never an empty one. */
export function clampPage(page: number, pageSize: number, count: number) {
  return Math.min(page, Math.max(1, Math.ceil(count / pageSize)));
}
