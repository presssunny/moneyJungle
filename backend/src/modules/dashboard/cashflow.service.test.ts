import { afterEach, describe, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ recurringPayment: { findMany: vi.fn() }, subscription: { findMany: vi.fn() }, loan: { findMany: vi.fn() }, reminder: { findMany: vi.fn() } }));
vi.mock("../../config/database", () => ({ prisma: db }));
import { buildUpcoming } from "./cashflow.service";

afterEach(() => vi.useRealTimers());
function setup() {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  Object.values(db).forEach((model) => model.findMany.mockResolvedValue([]));
}
describe("forward obligations", () => {
  it("uses the Israeli business day when UTC is still on the previous date", async () => {
    setup(); vi.setSystemTime(new Date("2026-09-17T22:30:00Z"));
    expect((await buildUpcoming(1, 1)).from).toBe("2026-09-18T00:00:00.000Z");
  });
  it("retains old occurrences through the current planning horizon without truncation", async () => {
    setup(); db.recurringPayment.findMany.mockResolvedValue([{ id: 1, name: "old", amount: 100, frequency: "monthly", nextPaymentDate: new Date("2020-01-31") }]);
    const result = await buildUpcoming(1, 62, new Date("2026-01-01"), true);
    expect(result.events[0].date.slice(0, 10)).toBe("2020-01-31");
    expect(result.events.at(-1)?.date.slice(0, 10)).toBe("2026-02-28");
    expect(result.events).toHaveLength(74);
  });
  it("does not schedule a monthly obligation before its first payment", async () => {
    setup(); db.recurringPayment.findMany.mockResolvedValue([{ name: "future", amount: 100, frequency: "monthly", nextPaymentDate: new Date("2026-03-31") }]);
    const result = await buildUpcoming(1, 150);
    expect(result.events.map((event) => event.date.slice(0, 10))).toEqual(["2026-03-31", "2026-04-30", "2026-05-31"]);
  });
  it("uses the final bank schedule installment without repeating the usual installment", async () => {
    setup(); db.loan.findMany.mockResolvedValue([{ loanName: "loan", scheduleSource: "bank_file", monthlyPayment: 100, schedule: [{ paymentDate: new Date("2026-02-01"), total: 35 }] }]);
    const result = await buildUpcoming(1, 365);
    expect(result.events).toHaveLength(1);
    expect(result.total).toBe(35);
  });
  it("ends computed loan obligations at the end date", async () => {
    setup(); db.loan.findMany.mockResolvedValue([{ loanName: "loan", scheduleSource: "computed", monthlyPayment: 100, currentBalance: 200, startDate: new Date("2025-12-10"), endDate: new Date("2026-02-10") }]);
    const result = await buildUpcoming(1, 365);
    expect(result.events.map((event) => event.date.slice(0, 10))).toEqual(["2026-01-10", "2026-02-10"]);
  });
  it("projects weekly payments even when their anchor is many years old", async () => {
    setup(); db.recurringPayment.findMany.mockResolvedValue([{ name: "weekly", amount: 100, frequency: "weekly", nextPaymentDate: new Date("2000-01-01") }]);
    const result = await buildUpcoming(1, 14);
    expect(result.events).toHaveLength(2);
  });
});
