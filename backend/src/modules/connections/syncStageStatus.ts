import type { PresentedSyncStage, SyncStage, SyncStageName, SyncStageStatus } from "../../types/connections.types";

// A skip is "not needed" only when there was nothing to do; any other skip means data was not collected.
const NOTHING_TO_DO = new Set(["NOT_NEEDED", "NO_LOAN_LINES", "NO_RECURRING"]);
const UNRECOGNIZED = "ROWS_UNRECOGNIZED";

/** The one rule for what a stage means to her; the page shows it and the final message counts it. */
export function stageStatus({ stage, state, code, count = 0 }: SyncStage): SyncStageStatus {
  switch (state) {
    case "done": return stage === "loan_schedule_import" && count > 0 ? "awaiting_approval" : "done";
    // Ambiguous loan lines, or the rows of a table that were read, wait for her on the import screen; any other partial lost data.
    case "partial": return (stage === "loan_detection" && code === "AMBIGUOUS") || code === UNRECOGNIZED ? "awaiting_approval" : "failed";
    case "skipped": return code === null || NOTHING_TO_DO.has(code) ? "not_needed" : "unavailable";
    case "blocked": return "blocked";
    // The bank has no such page, or showed it without a table we can read: missing at the source, not a failure of ours.
    case "failed": return code === "NOT_IN_MENU" || code === "UNAVAILABLE" ? "unavailable" : "failed";
  }
}

const NOT_COLLECTED = new Set<SyncStageStatus>(["failed", "unavailable", "blocked"]);
// Rows of the bank's table we could not place may be a loan she owes, so what was read waits for her and the gap is still named (banker).
const notCollected = (s: SyncStage) => NOT_COLLECTED.has(stageStatus(s)) || (s.state === "partial" && s.code === UNRECOGNIZED);

// Computed at read time, so a sync stored before statuses existed reads the same as a new one.
export const presentStages = (stages: SyncStage[]): PresentedSyncStage[] => stages.map((s) => ({ ...s, status: stageStatus(s) }));
export const stagesIncomplete = (stages: SyncStage[]) => stages.some(notCollected);

// All four loan stages name one gap for her: the loan's details.
const STAGE_LABELS: Record<SyncStageName, string> = {
  checking: "תנועות עו״ש",
  loan_detection: "פרטי הלוואות", loans_department: "פרטי הלוואות", loan_details: "פרטי הלוואות", loan_schedule_import: "פרטי הלוואות",
  standing_orders_detection: "זיהוי הוראות קבע",
  standing_orders_verification: "אימות הוראות קבע",
  bank_documents: "מסמכי בנק",
};

/** What the sync did not bring, once per gap — the same stages `stagesIncomplete` counts. */
export function notCollectedLabels(stages: SyncStage[]): string[] {
  return [...new Set(stages.filter(notCollected).map((s) => STAGE_LABELS[s.stage]))];
}
