import type { ForecastScenario } from "../types/models";
import { currentUser } from "./gate.service";

export const emptyForecastScenario: ForecastScenario = {
  monthlyIncomeChange: 0, monthlyExpenseChange: 0, oneTimeExpense: 0, oneTimeMonth: 1,
};

function preferenceKey() {
  const userId = currentUser()?.id;
  return userId === undefined ? null : `mj_forecast_v1_${userId}`;
}

function within(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

export function readForecastPreferences(): { scenario: ForecastScenario; excluded: string[] } {
  const fallback = { scenario: { ...emptyForecastScenario }, excluded: [] };
  try {
    const key = preferenceKey();
    const raw: unknown = key ? JSON.parse(localStorage.getItem(key) ?? "null") : null;
    if (!raw || typeof raw !== "object" || !("anchor" in raw) || raw.anchor !== new Date().toISOString().slice(0, 7) || !("scenario" in raw) || !("excluded" in raw)) return fallback;
    const scenario = raw.scenario;
    if (!scenario || typeof scenario !== "object" ||
      !("monthlyIncomeChange" in scenario) || !within(scenario.monthlyIncomeChange, -1000000, 1000000) ||
      !("monthlyExpenseChange" in scenario) || !within(scenario.monthlyExpenseChange, -1000000, 1000000) ||
      !("oneTimeExpense" in scenario) || !within(scenario.oneTimeExpense, 0, 10000000) ||
      !("oneTimeMonth" in scenario) || !within(scenario.oneTimeMonth, 1, 12) || !Number.isInteger(scenario.oneTimeMonth) ||
      !Array.isArray(raw.excluded) || raw.excluded.length > 6 || !raw.excluded.every((month: unknown) => typeof month === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(month))) return fallback;
    return { scenario: { monthlyIncomeChange: scenario.monthlyIncomeChange, monthlyExpenseChange: scenario.monthlyExpenseChange,
      oneTimeExpense: scenario.oneTimeExpense, oneTimeMonth: scenario.oneTimeMonth }, excluded: raw.excluded as string[] };
  } catch { return fallback; }
}

export function saveForecastPreferences(scenario: ForecastScenario, excluded: string[], anchor: string): boolean {
  try {
    const key = preferenceKey();
    if (!key) return false;
    // An offset like "month 3" must not silently move a one-time expense when the calendar rolls over.
    localStorage.setItem(key, JSON.stringify({ anchor, scenario, excluded }));
    return true;
  } catch { return false; }
}
