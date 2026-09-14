import { reportsService } from "./reports.service";
import { buildUpcoming } from "../dashboard/cashflow.service";
import { round2 } from "../../utils/money.utils";
import type { ForecastHistoryMonth, ForecastMonth, ForecastScenario } from "../../types/planning.types";

function historicalBaseline(history: ForecastHistoryMonth[], excludedMonths: string[]) {
  // Recorded activity is not proof of complete statement coverage; the UI labels the baseline accordingly.
  const eligible = history.filter((row) => row.incomeTotal > 0 && row.expenseTotal > 0 && !excludedMonths.includes(row.monthKey));
  const sufficient = eligible.length >= 3;
  const mean = (key: "incomeTotal" | "expenseTotal") => sufficient ? round2(eligible.reduce((sum, row) => sum + row[key], 0) / eligible.length) : null;
  const income = mean("incomeTotal");
  const expense = mean("expenseTotal");
  return { eligible, sufficient, income, expense };
}

export function backtestForecast(history: ForecastHistoryMonth[], excludedMonths: string[] = []) {
  const errors: number[] = [];
  const sorted = [...history].sort((a, b) => a.monthKey.localeCompare(b.monthKey));
  for (const target of sorted) {
    if (excludedMonths.includes(target.monthKey) || target.incomeTotal <= 0 || target.expenseTotal <= 0) continue;
    const baseline = historicalBaseline(sorted.filter((row) => row.monthKey < target.monthKey).slice(-6), excludedMonths);
    if (baseline.expense !== null) errors.push(Math.abs(baseline.expense - target.expenseTotal));
  }
  return { monthsTested: errors.length, meanAbsoluteExpenseError: errors.length ? round2(errors.reduce((sum, value) => sum + value, 0) / errors.length) : null };
}

export function calculateForecast(history: ForecastHistoryMonth[], anchor: Date, scenario: ForecastScenario, excludedMonths: string[] = []) {
  const { eligible, sufficient, income, expense } = historicalBaseline(history, excludedMonths);
  const months: ForecastMonth[] = Array.from({ length: 12 }, (_, offset) => {
    const monthKey = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + offset + 1, 1)).toISOString().slice(0, 7);
    const balance = income !== null && expense !== null ? round2(income - expense) : null;
    const changedExpense = expense === null ? null : Math.max(0, expense + scenario.monthlyExpenseChange) + (offset + 1 === scenario.oneTimeMonth ? scenario.oneTimeExpense : 0);
    return { monthKey, incomeTotal: income, expenseTotal: expense, balance,
      scenarioBalance: income === null || changedExpense === null ? null : round2(Math.max(0, income + scenario.monthlyIncomeChange) - changedExpense) };
  });
  return { history, baselineMonths: eligible.map((row) => row.monthKey), sufficient, months, backtest: backtestForecast(history, excludedMonths),
    annualBalance: sufficient ? round2(months.reduce((sum, row) => sum + row.balance!, 0)) : null,
    scenarioAnnualBalance: sufficient ? round2(months.reduce((sum, row) => sum + row.scenarioBalance!, 0)) : null };
}

export async function getForecast(userId: number, scenario: ForecastScenario, excludedMonths: string[]) {
  const now = new Date();
  const anchor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const lastComplete = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const [history, upcoming] = await Promise.all([
    reportsService.trend(userId, lastComplete.getUTCFullYear(), lastComplete.getUTCMonth() + 1, 6),
    buildUpcoming(userId, 400),
  ]);
  const result = calculateForecast(history, anchor, scenario, excludedMonths);
  const commitments = result.months.map((month) => {
    const events = upcoming.events.filter((event) => event.date.startsWith(month.monthKey));
    return { monthKey: month.monthKey, events, total: round2(events.reduce((sum, event) => sum + event.amount, 0)) };
  });
  const heaviest = commitments.reduce((max, row) => row.total > max.total ? row : max, commitments[0]);
  return { ...result, commitments, heaviest: heaviest.total > 0 ? { monthKey: heaviest.monthKey, total: heaviest.total } : null,
    generatedAt: now.toISOString(), anchorMonth: anchor.toISOString().slice(0, 7) };
}
