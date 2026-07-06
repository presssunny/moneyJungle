/** Formatting helpers — all display formatting lives here. */

export function formatCurrency(amount: number | null | undefined, options?: { sign?: boolean }): string {
  const value = amount ?? 0;
  const formatted = new Intl.NumberFormat("he-IL", {
    style: "currency",
    currency: "ILS",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(Math.abs(value));
  if (options?.sign && value !== 0) {
    return `${value > 0 ? "+" : "-"}${formatted}`;
  }
  return value < 0 ? `-${formatted}` : formatted;
}

export function formatDate(date: string | Date | null | undefined): string {
  if (!date) return "";
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function calculatePercent(used: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((used / total) * 1000) / 10;
}

export const HEBREW_MONTHS = [
  "ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני",
  "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר",
];

/** "2026-07" → "יולי 2026" */
export function formatMonthKey(monthKey: string): string {
  const [year, month] = monthKey.split("-").map(Number);
  return `${HEBREW_MONTHS[month - 1]} ${year}`;
}

export function currentMonthKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function shiftMonthKey(monthKey: string, delta: number): string {
  const [year, month] = monthKey.split("-").map(Number);
  const d = new Date(year, month - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
