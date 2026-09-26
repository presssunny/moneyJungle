/** All inputs are cash, not accrual expenses. Caller must establish coverage first. */
export interface CashObligation { date: string; amount: number }
export function calculateAllowance(cash: number, reserve: number, essential: number, dates: string[], obligations: CashObligation[]) {
  if (!dates.length || [cash, reserve, essential, ...obligations.map(o => o.amount)].some(n => !Number.isFinite(n))) throw new Error("Invalid cash inputs");
  let daily = Infinity;
  let minimum = Infinity;
  let limitingDate = dates[0];
  for (let i = 0; i < dates.length; i++) {
    const out = obligations.filter(o => o.date <= dates[i]).reduce((sum, o) => sum + Math.round(o.amount * 100), 0);
    const available = Math.round((cash - reserve) * 100) - out - Math.round(essential * 100 * (i + 1) / dates.length);
    minimum = Math.min(minimum, available);
    if (available / (i + 1) < daily) limitingDate = dates[i];
    daily = Math.min(daily, available / (i + 1));
  }
  return { limitingDate, daily: Math.max(0, Math.floor(daily)) / 100, shortfall: Math.max(0, -minimum) / 100 };
}

/**
 * Another account's own charges against its own cash: the worst shortfall over the
 * period and the first day it appears. The spending account must send that amount
 * by then; a surplus there is never counted as available (banker ruling 2026-09-26).
 */
export function accountDeficit(cash: number, dates: string[], obligations: CashObligation[], afterPeriod = 0) {
  if (!dates.length || [cash, afterPeriod, ...obligations.map(o => o.amount)].some(n => !Number.isFinite(n))) throw new Error("Invalid cash inputs");
  let worst = 0;
  let firstDate: string | null = null;
  for (let i = 0; i < dates.length; i++) {
    const out = obligations.filter(o => o.date <= dates[i]).reduce((sum, o) => sum + Math.round(o.amount * 100), 0)
      + (i === dates.length - 1 ? Math.round(afterPeriod * 100) : 0);
    const balance = Math.round(cash * 100) - out;
    if (balance < 0 && firstDate === null) firstDate = dates[i];
    worst = Math.min(worst, balance);
  }
  return { amount: worst < 0 ? -worst / 100 : 0, date: firstDate };
}
