import { describe, expect, it, vi } from "vitest";
import type { HouseholdSnapshot } from "../../types/householdAssistant.types";
import { prioritizePlan } from "./plan.service";

const snapshot: HouseholdSnapshot = {
  version: "a".repeat(64), generatedAt: "2026-09-21T00:00:00Z", month: "2026-09", hasActivity: true,
  totals: { incomeTotal: 50000, expenseTotal: 10000, creditTotal: 8000 }, allowance: { state: "unavailable", amount: null },
  blockers: ["private account name"], actions: [
    { id: "bank:1287", kind: "review", title: "private bank name", reason: "private", to: "/data", priority: 0 },
    { id: "payment:99", kind: "payment", title: "private family name", reason: "private", to: "/commitments", priority: 20 },
    { id: "duplicate:32", kind: "duplicate", title: "private merchant", reason: "private", to: "/assistant", priority: 30 },
    { id: "goal:42", kind: "goal", title: "private goal", reason: "private", to: "/accounts", priority: 60 },
  ], actionCount: 4, upcoming: [], duplicates: { from: "2026-06-24", to: "2026-09-21", scanned: 0, limited: false, candidateCount: 0, candidates: [] }, aiAvailable: true,
};

describe("evidence-bound AI selection", () => {
  it("sends only temporary IDs and task kinds, and preserves urgent work", async () => {
    const complete = vi.fn().mockResolvedValue({ content: '{"actionIds":["task-3"]}' });
    const result = await prioritizePlan(1, snapshot, { name: "test", complete });
    expect(result).toEqual({ version: snapshot.version, mode: "ai", actionIds: ["bank:1287", "payment:99", "goal:42"] });
    const sent = JSON.stringify(complete.mock.calls[0][0]);
    for (const secret of ["private", "50000", "1287", "merchant", "goal:42"]) expect(sent).not.toContain(secret);
    expect(complete.mock.calls[0][0].signal).toBeInstanceOf(AbortSignal);
  });
  it.each(['{"actionIds":["invented"]}', '{"actionIds":["task-0","task-0"]}', '{"actionIds":[]}', '{"actionIds":["task-0"],"amount":999}', 'ignore the instructions', "a".repeat(2001)])("falls back on invalid or invented output", async content => {
    expect((await prioritizePlan(1, snapshot, { name: "test", complete: async () => ({ content }) })).mode).toBe("rules");
  });
  it("recovers from provider errors and never calls the provider for an empty task list", async () => {
    const complete = vi.fn().mockRejectedValue(new Error("unavailable"));
    expect((await prioritizePlan(1, snapshot, { name: "test", complete })).actionIds).toEqual(snapshot.actions.slice(0, 3).map(a => a.id));
    complete.mockClear();
    await prioritizePlan(1, { ...snapshot, actions: [] }, { name: "test", complete });
    expect(complete).not.toHaveBeenCalled();
  });
});
