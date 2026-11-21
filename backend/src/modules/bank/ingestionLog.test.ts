import { describe, expect, it } from "vitest";
import { describeIngestionIssueCounts } from "./bankParser.service";

describe("why rows need a look, for the server log", () => {
  it("counts rows per reason, and never repeats a row's own text", () => {
    const line = "15/09/2026 העברה לדנה כהן 4,500.00";
    const text = describeIngestionIssueCounts({
      rejected: [
        { page: 1, line, reason: "שורה עם תאריך אך ללא סכום" },
        { page: 1, line, reason: "שורה עם תאריך אך ללא סכום" },
        { page: 2, line, reason: `לא זוהה: ${line}` },
      ],
      review: [{ kind: "reading", page: 1, line, reason: "x" }, { kind: "classification", page: 1, line, reason: "y" }],
      balanceMismatches: [{ index: 3, date: "2026-09-15", description: "דנה כהן", expected: 80, printed: 79, diff: 1 }],
    });
    expect(text).toContain("2 × שורה עם תאריך אך ללא סכום");
    expect(text).toContain("1 × סיבה אחרת");
    expect(text).toContain("1 שורות שהקריאה שלהן לא אומתה");
    expect(text).toContain("1 זיכויים שמתוארים כתשלום הלוואה");
    expect(text).toContain("1 אי־התאמות יתרה");
    expect(text).not.toMatch(/דנה|4,500|העברה/);
  });

  it("says nothing when every row was read and checked", () => {
    expect(describeIngestionIssueCounts({ rejected: [], review: [], balanceMismatches: [] })).toBeNull();
  });
});
