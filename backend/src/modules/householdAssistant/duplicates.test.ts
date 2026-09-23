import { describe, expect, it } from "vitest";
import { duplicateCandidates, type ScanRecord } from "./duplicates";

const row = (key: string, patch: Partial<ScanRecord> = {}): ScanRecord => ({ key, version: key, kind: "expense", name: "סופר השכונה", amount: 123.45, date: "2026-09-20", scope: "unknown", manual: true, cardEligible: true, to: "/transactions", ...patch });

describe("duplicate review evidence", () => {
  it("groups repeated entries without losing their multiplicity", () => {
    const result = duplicateCandidates([row("expense:1"), row("expense:2"), row("expense:3")]);
    expect(result).toHaveLength(1);
    expect(result[0].recordCount).toBe(3);
    expect(result[0].records).toHaveLength(3);
    expect(result[0].reason).toBe("same_entry");
  });
  it("normalizes whitespace and direction markers, not merchant meaning", () => {
    expect(duplicateCandidates([row("a"), row("b", { name: "  סופר  השכונה\u200f " })])).toHaveLength(1);
    expect(duplicateCandidates([row("a"), row("b", { name: "סופר אחר" })])).toHaveLength(0);
  });
  it.each([
    { amount: -123.45 }, { amount: 0 }, { amount: 123.46 }, { date: "2026-09-21" },
    { name: "" }, { kind: "income" as const }, { scope: "another-payment-method" },
  ])("does not merge opposite signs, different dates, names, directions or methods: %j", patch => {
    expect(duplicateCandidates([row("a"), row("b", patch)])).toHaveLength(0);
  });
  it("compares a manual card purchase with credit evidence, never a cash purchase", () => {
    const card = row("credit:1", { kind: "credit", scope: "1", manual: false });
    expect(duplicateCandidates([row("expense:1"), card])[0].reason).toBe("manual_and_card");
    expect(duplicateCandidates([row("expense:1", { cardEligible: false }), card])).toHaveLength(0);
  });
  it("keeps separate cards and income types separate", () => {
    expect(duplicateCandidates([row("a", { kind: "credit", scope: "1" }), row("b", { kind: "credit", scope: "2" })])).toHaveLength(0);
    expect(duplicateCandidates([row("a", { kind: "income", scope: "salary" }), row("b", { kind: "income", scope: "gift" })])).toHaveLength(0);
  });
  it("returns a stable identity independent of query order", () => {
    expect(duplicateCandidates([row("a"), row("b")])).toEqual(duplicateCandidates([row("b"), row("a")]));
  });
});
