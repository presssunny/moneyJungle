/** Date helpers — months are 1-12 everywhere in the API. */

export function monthRange(year: number, month: number): { start: Date; end: Date } {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1)); // exclusive
  return { start, end };
}

/** Parse "YYYY-MM" into { year, month }. Returns null when malformed. */
export function parseMonthKey(key: string): { year: number; month: number } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(key);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return { year, month };
}

export function toMonthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export function startOfToday(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

export function daysUntil(date: Date): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.ceil((date.getTime() - startOfToday().getTime()) / msPerDay);
}

/** "היום" / "מחר" / "בעוד 5 ימים" / a date — how near-term events are worded everywhere. */
export function relativeDayLabel(date: Date): string {
  const days = daysUntil(date);
  if (days <= 0) return "היום";
  if (days === 1) return "מחר";
  if (days <= 7) return `בעוד ${days} ימים`;
  return date.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit" });
}
