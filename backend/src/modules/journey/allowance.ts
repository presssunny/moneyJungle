/** All inputs are cash, not accrual expenses. Caller must establish coverage first. */
export interface CashObligation { date: string; amount: number }
export function calculateAllowance(cash: number, reserve: number, essential: number, dates: string[], obligations: CashObligation[]) {
  if (!dates.length || [cash, reserve, essential, ...obligations.map(o => o.amount)].some(n => !Number.isFinite(n))) throw new Error("Invalid cash inputs");
  let daily = Infinity;
  let minimum = Infinity;
  for (let i = 0; i < dates.length; i++) {
    const out = obligations.filter(o => o.date <= dates[i]).reduce((sum, o) => sum + Math.round(o.amount * 100), 0);
    const available = Math.round((cash - reserve) * 100) - out - Math.round(essential * 100 * (i + 1) / dates.length);
    minimum = Math.min(minimum, available);
    daily = Math.min(daily, available / (i + 1));
  }
  return { daily: Math.max(0, Math.floor(daily)) / 100, shortfall: Math.max(0, -minimum) / 100 };
}
