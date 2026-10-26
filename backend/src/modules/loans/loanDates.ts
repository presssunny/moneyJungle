/**
 * `startDate` means different things by where the loan came from: the opening
 * date she typed (computed), or a recorded payment date — the next debit seen on
 * a statement, or the first row of the bank's schedule. Both keep the payment's
 * day of month, so the next payment is derived from it here and only here.
 */
export type StartDateMeaning = "opening" | "recorded";

export function startDateMeaning(loan: { scheduleSource: string }): StartDateMeaning {
  return loan.scheduleSource === "computed" ? "opening" : "recorded";
}

/** The `day` of a month, clamped to its last day (31 → 28/29/30). */
export function onDayOfMonth(year: number, month: number, day: number): Date {
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(day, lastDay)));
}

/** The loan's first payment: an opening date is not itself a payment, so it falls a month later. */
export function firstPaymentDate(loan: { startDate: Date; scheduleSource: string }): Date {
  const start = new Date(loan.startDate);
  const offset = startDateMeaning(loan) === "opening" ? 1 : 0;
  return onDayOfMonth(start.getUTCFullYear(), start.getUTCMonth() + offset, start.getUTCDate());
}

/** First payment on or after `today` (a UTC midnight date). */
export function nextPaymentDate(loan: { startDate: Date; scheduleSource: string }, today: Date): Date {
  const day = new Date(loan.startDate).getUTCDate();
  const earliest = firstPaymentDate(loan);
  const from = earliest > today ? earliest : today;
  let year = from.getUTCFullYear();
  let month = from.getUTCMonth();
  let candidate = onDayOfMonth(year, month, day);
  while (candidate < from) {
    month += 1;
    if (month > 11) { month = 0; year += 1; }
    candidate = onDayOfMonth(year, month, day);
  }
  return candidate;
}

/** The payment `count` months after `first`, on the loan's own day of month. */
export function paymentAfter(first: Date, day: number, count: number): Date {
  return onDayOfMonth(first.getUTCFullYear(), first.getUTCMonth() + count, day);
}
