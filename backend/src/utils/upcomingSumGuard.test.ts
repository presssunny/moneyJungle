import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Upcoming totals are summed once, in cashflow.service (sumKnown, per window and per
// month). A second sum elsewhere drifts on unknown amounts — CLAUDE.md §4.
const OWNER = path.join("modules", "dashboard", "cashflow.service.ts");
const RESUM = /\bevents\.reduce\(|(\.reduce\(|sumKnown\()[^\n]*\b(e|event)\.amount\b/;

const SRC = path.resolve(__dirname, "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [full] : [];
  });
}

describe("upcoming obligations are summed in one place", () => {
  it("catches the pattern it is meant to catch", () => {
    expect(RESUM.test("total: sumKnown(events.map((event) => event.amount))")).toBe(true);
    expect(RESUM.test("events.reduce((sum, e) => sum + e.amount, 0)")).toBe(true);
    expect(RESUM.test("const month = upcoming.months.find((m) => m.monthKey === key)")).toBe(false);
    expect(RESUM.test("rows.reduce((sum, row) => sum + decimalToNumber(row.amount), 0)")).toBe(false);
  });

  it("no file that reads buildUpcoming re-sums its event amounts", () => {
    const offenders = sourceFiles(SRC)
      .filter((file) => path.relative(SRC, file) !== OWNER && readFileSync(file, "utf8").includes("buildUpcoming"))
      .flatMap((file) =>
        readFileSync(file, "utf8")
          .split("\n")
          .flatMap((line, i) => (RESUM.test(line) ? [`${path.relative(SRC, file)}:${i + 1}`] : []))
      );
    expect(offenders).toEqual([]);
  });
});
