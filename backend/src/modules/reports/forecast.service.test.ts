import { describe, expect, it, vi } from "vitest";
vi.mock("./reports.service", () => ({ reportsService: { trend: vi.fn() } }));
vi.mock("../dashboard/cashflow.service", () => ({ buildUpcoming: vi.fn() }));
import { backtestForecast, calculateForecast } from "./forecast.service";

const anchor = new Date("2026-12-01T00:00:00Z");
const scenario = { monthlyIncomeChange: 0, monthlyExpenseChange: 0, oneTimeExpense: 0, oneTimeMonth: 1 };
const history = ["2026-09", "2026-10", "2026-11"].map((monthKey) => ({ monthKey, incomeTotal: 10000, expenseTotal: 8000, balance: 2000 }));

describe("annual forecast", () => {
  it("crosses years and preserves the historical monthly balance without counting commitments twice", () => {
    const result = calculateForecast(history, anchor, scenario);
    expect(result.months).toHaveLength(12);
    expect(result.months[0].monthKey).toBe("2027-01");
    expect(result.months[11].monthKey).toBe("2027-12");
    expect(result.annualBalance).toBe(24000);
  });
  it("does not dilute the baseline with missing months", () => {
    const result = calculateForecast([...history, { monthKey: "2026-08", incomeTotal: 0, expenseTotal: 0, balance: 0 }], anchor, scenario);
    expect(result.baselineMonths).toHaveLength(3);
    expect(result.annualBalance).toBe(24000);
  });
  it("returns unknown with insufficient or excluded history", () => {
    const result = calculateForecast(history, anchor, scenario, ["2026-09"]);
    expect(result.sufficient).toBe(false);
    expect(result.annualBalance).toBeNull();
    expect(result.months.every((row) => row.scenarioBalance === null)).toBe(true);
  });
  it("applies a one-time expense once and a monthly saving twelve times without changing history", () => {
    const result = calculateForecast(history, anchor, { ...scenario, monthlyExpenseChange: -500, oneTimeExpense: 1000, oneTimeMonth: 3 });
    expect(result.scenarioAnnualBalance).toBe(29000);
    expect(result.months[2].scenarioBalance).toBe(1500);
    expect(result.months[3].scenarioBalance).toBe(2500);
    expect(history[0].expenseTotal).toBe(8000);
  });
  it("does not turn expense reductions into negative spending", () => {
    const result = calculateForecast(history, anchor, { ...scenario, monthlyExpenseChange: -9000 });
    expect(result.months[0].scenarioBalance).toBe(10000);
  });
  it("backtests without using the target month or future months in its baseline", () => {
    const result = backtestForecast([...history, { monthKey: "2026-12", incomeTotal: 10000, expenseTotal: 14000, balance: -4000 }]);
    expect(result.monthsTested).toBe(1);
    expect(result.meanAbsoluteExpenseError).toBe(6000);
    expect(backtestForecast(history).monthsTested).toBe(0);
  });
});
