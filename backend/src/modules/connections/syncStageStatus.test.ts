import { describe, expect, it } from "vitest";
import type { SyncStage, SyncStageName, SyncStageState, SyncStageStatus } from "../../types/connections.types";
import { notCollectedLabels, presentStages, stagesIncomplete, stageStatus } from "./syncStageStatus";

const s = (stage: SyncStageName, state: SyncStageState, code: string | null = null, count?: number): SyncStage => ({ stage, state, code, ...(count === undefined ? {} : { count }) });
const unrecognized = (stage: SyncStageName, count: number, rejected: number): SyncStage => ({ ...s(stage, "partial", "ROWS_UNRECOGNIZED", count), rejected });

// Every combination the sync produces (connectionSync, loanSync, standingOrdersSync), plus the unknown-code fallbacks.
const CASES: Array<[SyncStage, SyncStageStatus]> = [
  [s("checking", "done", null, 5), "done"],
  [s("loan_detection", "done", null, 2), "done"],
  [s("loan_detection", "partial", "AMBIGUOUS", 1), "awaiting_approval"],
  [s("loan_detection", "skipped", "NO_LOAN_LINES", 0), "not_needed"],
  [s("loans_department", "done"), "done"],
  [s("loans_department", "skipped", "NOT_NEEDED"), "not_needed"],
  [s("loans_department", "skipped", "DISABLED"), "unavailable"],
  [s("loans_department", "skipped", "NOT_OFFICIAL_WINDOW"), "unavailable"],
  [s("loans_department", "failed", "NOT_IN_MENU"), "unavailable"],
  ...(["ERROR", "SESSION_LOST", "CHALLENGE", "REDIRECT", "HTTP_STATUS", "NEW_TAB", "BUDGET", "CLOSED", "NO_DECISION"] as const)
    .map((code): [SyncStage, SyncStageStatus] => [s("loans_department", "failed", code), "failed"]),
  [s("loan_details", "done", null, 1), "done"],
  [unrecognized("loan_details", 2, 1), "awaiting_approval"],
  [s("loan_details", "blocked", "NOT_APPROVED"), "blocked"],
  [s("loan_details", "skipped", "NOT_NEEDED"), "not_needed"],
  [s("loan_details", "skipped", "NOT_RUN"), "unavailable"],
  [s("loan_details", "failed", "EXTRAS_INVALID"), "failed"],
  [s("loan_details", "failed", "UNAVAILABLE"), "unavailable"],
  [s("loan_details", "failed", "FAILED"), "failed"],
  [s("loan_schedule_import", "done", null, 2), "awaiting_approval"],
  [s("loan_schedule_import", "done", null, 0), "done"],
  [s("loan_schedule_import", "done"), "done"],
  [s("loan_schedule_import", "skipped", null, 0), "not_needed"],
  [s("loan_schedule_import", "partial", "IDENTIFIER_UNREADABLE", 1), "failed"],
  [s("loan_schedule_import", "failed", "SCHEDULE_REJECTED"), "failed"],
  [s("loan_schedule_import", "failed", "IMPORT_FAILED"), "failed"],
  [s("standing_orders_detection", "done", "INFERRED", 3), "done"],
  [s("standing_orders_detection", "skipped", "NO_RECURRING", 0), "not_needed"],
  [s("standing_orders_detection", "skipped", "WINDOW_TOO_SHORT", 0), "unavailable"],
  [s("standing_orders_detection", "failed", "ERROR", 0), "failed"],
  [s("standing_orders_verification", "blocked", "NOT_APPROVED"), "blocked"],
  [s("standing_orders_verification", "done", null, 3), "done"],
  [unrecognized("standing_orders_verification", 3, 2), "awaiting_approval"],
  [s("standing_orders_verification", "failed", "UNAVAILABLE"), "unavailable"],
  [s("standing_orders_verification", "failed", "NOT_IN_MENU"), "unavailable"],
  [s("standing_orders_verification", "failed", "SESSION_LOST"), "failed"],
  [s("standing_orders_verification", "failed", "EXTRAS_INVALID"), "failed"],
  [s("standing_orders_verification", "skipped", "NOT_NEEDED"), "not_needed"],
  [s("standing_orders_verification", "skipped", "NOT_RUN"), "unavailable"],
  [s("bank_documents", "blocked", "NOT_APPROVED"), "blocked"],
  [s("checking", "skipped", "SOMETHING_NEW"), "unavailable"],
  [s("checking", "partial", "SOMETHING_NEW"), "failed"],
];

describe("stageStatus", () => {
  it.each(CASES)("%o → %s", (stage, status) => {
    expect(stageStatus(stage)).toBe(status);
  });

  // The two rules the page and the message used to disagree on (QA 2026-11-14).
  it("ambiguous loan lines wait for her and are not a gap; a skip by setting, window or too few months is", () => {
    expect(notCollectedLabels([s("loan_detection", "partial", "AMBIGUOUS", 1)])).toEqual([]);
    expect(stagesIncomplete([s("loan_detection", "partial", "AMBIGUOUS", 1)])).toBe(false);
    expect(notCollectedLabels([s("loans_department", "skipped", "DISABLED")])).toEqual(["פרטי הלוואות"]);
    expect(notCollectedLabels([s("loans_department", "skipped", "NOT_OFFICIAL_WINDOW")])).toEqual(["פרטי הלוואות"]);
    expect(notCollectedLabels([s("standing_orders_detection", "skipped", "WINDOW_TOO_SHORT", 0)])).toEqual(["זיהוי הוראות קבע"]);
  });

  // Banker: a table read with rows we could not place may hide a loan, so it is never a plain "done".
  it("a table read with unrecognised rows waits for her approval and is still named as not collected", () => {
    const loans = unrecognized("loan_details", 2, 1);
    const orders = unrecognized("standing_orders_verification", 3, 2);
    expect(stageStatus(loans)).toBe("awaiting_approval");
    expect(stagesIncomplete([loans])).toBe(true);
    expect(stagesIncomplete([orders])).toBe(true);
    expect(notCollectedLabels([s("checking", "done", null, 4), loans, orders])).toEqual(["פרטי הלוואות", "אימות הוראות קבע"]);
    expect(stagesIncomplete([s("loan_details", "done", null, 2), s("standing_orders_verification", "done", null, 3)])).toBe(false);
  });
});

describe("one rule for the page and the message", () => {
  const NOT_COLLECTED: SyncStageStatus[] = ["failed", "unavailable", "blocked"];

  // The one exception to "status says so": rows read but not all recognised wait for her and are a gap too.
  const gap = (stage: SyncStage, status: SyncStageStatus) => NOT_COLLECTED.includes(status) || stage.code === "ROWS_UNRECOGNIZED";

  it.each(CASES)("%o is listed as not collected exactly when its status says so", (stage, status) => {
    expect(notCollectedLabels([stage]).length > 0).toBe(gap(stage, status));
    expect(stagesIncomplete([stage])).toBe(gap(stage, status));
  });

  it("names each gap once, in stage order, and attaches the same status the message used", () => {
    const stages = CASES.map(([stage]) => stage);
    expect(notCollectedLabels(stages)).toEqual(["פרטי הלוואות", "זיהוי הוראות קבע", "אימות הוראות קבע", "מסמכי בנק", "תנועות עו״ש"]);
    expect(presentStages(stages).map((p) => p.status)).toEqual(CASES.map(([, status]) => status));
  });

  it("a sync of done and not-needed stages is complete and lists nothing", () => {
    const stages = [s("checking", "done", null, 1), s("loan_detection", "skipped", "NO_LOAN_LINES", 0), s("loans_department", "skipped", "NOT_NEEDED"), s("standing_orders_detection", "done", "INFERRED", 1)];
    expect(stagesIncomplete(stages)).toBe(false);
    expect(notCollectedLabels(stages)).toEqual([]);
  });

  it("recomputes from state and code, never trusting a status already in the stored row", () => {
    const stored = { ...s("loan_details", "blocked", "NOT_APPROVED"), status: "done" } as SyncStage;
    expect(presentStages([stored])[0].status).toBe("blocked");
  });
});
