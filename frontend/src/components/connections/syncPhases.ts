import type { ConnectionSync, FinancialConnection, SyncPhase } from "../../types/models";

export const isActive = (connection: FinancialConnection) => connection.syncs[0]?.status === "running";

const LABELS: Record<SyncPhase, string> = {
  queued: "מתכוננים",
  launching: "פותחים את חלון הבנק",
  awaiting_bank: "ממתינים לתשובת הבנק",
  awaiting_user: "ממתינים שתיכנסי בחלון של הבנק",
  fetching: "התחברת. קוראים את התנועות",
  building_import: "מכינים את התנועות לבדיקה",
};

export function phaseLabel(phase: SyncPhase | null): string {
  return phase ? LABELS[phase] : LABELS.queued;
}

/** Import statuses she still has to act on (review, or answer a question). */
export const REVIEWABLE = ["ready_for_review", "needs_input"];
const APPROVED = ["completed", "review"];
/** Whether any import from this sync still waits for her — the summary and the dialog's announcement share it. */
export const awaitsReview = (sync: ConnectionSync) => (sync.outcome ?? []).some((item) => REVIEWABLE.includes(item.review?.status ?? ""));

/**
 * The bank's site as she can check it in Chrome's address bar: "fibi.co.il", not the full host, so a
 * login that moves to a subdomain still matches. The lock icon is gone from recent Chrome; the name is the proof.
 */
export const siteDomain = (url: string | null) => (url ? new URL(url).hostname.replace(/^www\./, "") : null);

export const isWaiting = (sync: ConnectionSync) => sync.phase === "awaiting_bank" || sync.phase === "awaiting_user";

/** "ל" + "הבנק הבינלאומי" is "לבנק הבינלאומי": the prefix swallows the definite article. */
export const toName = (name: string) => `ל${name.replace(/^ה/, "")}`;

// The server moves to "fetching" only on the library's LOGIN_SUCCESS; nothing earlier means she is in.
const AFTER_LOGIN: Array<SyncPhase | null> = ["fetching", "building_import"];

/** Three different successes, each true only once the server has said so — never inferred here. */
export function milestones(sync: ConnectionSync) {
  const sessions = (sync.outcome ?? []).filter((item) => item.review);
  return {
    windowOpen: sync.phase === "awaiting_user" || sync.phase === "awaiting_bank" || AFTER_LOGIN.includes(sync.phase) || sync.status === "succeeded",
    signedIn: AFTER_LOGIN.includes(sync.phase) || sync.status === "succeeded",
    fetched: sync.phase === "building_import" || sync.status === "succeeded",
    synced: sync.status === "succeeded",
    approved: sessions.length > 0 && sessions.every((item) => APPROVED.includes(item.review!.status)),
  };
}

export type StepState = "done" | "current" | "failed" | "todo";
export interface JourneyStep { key: string; label: string; doneLabel: string; state: StepState }

/**
 * The connection as she lives it: open the bank's window, sign in there, read, review, approve.
 * The first step not yet done is current while the sync runs — or where it stopped, if it failed.
 */
export function journey(sync: ConnectionSync, bankName: string): JourneyStep[] {
  const m = milestones(sync);
  const official = sync.method === "official_window";
  const nothingToApprove = m.synced && !(sync.outcome ?? []).some((item) => item.review);
  const steps = [
    { key: "window", label: official ? `פותחים את החלון של ${bankName}` : "פותחים חיבור ברקע", doneLabel: official ? `החלון של ${bankName} נפתח` : "החיבור נפתח", done: m.windowOpen },
    { key: "signin", label: official ? "ממתינים שתיכנסי בחלון של הבנק" : "ממתינים לתשובת הבנק", doneLabel: `התחברת בהצלחה ${toName(bankName)}`, done: m.signedIn },
    { key: "fetch", label: "קוראים את התנועות", doneLabel: "התנועות נקראו", done: m.fetched },
    { key: "sync", label: "מכינים את התנועות לבדיקה", doneLabel: "הסנכרון הושלם", done: m.synced },
    nothingToApprove
      ? { key: "approve", label: "", doneLabel: "אין תנועות חדשות לאישור", done: true }
      : { key: "approve", label: "מחכה לאישור שלך במסך הייבוא", doneLabel: "הייבוא אושר", done: m.approved },
  ];
  const stopped = sync.status === "failed" || sync.status === "cancelled";
  const firstOpen = steps.findIndex((step) => !step.done);
  // After the sync the next move is hers — approving on the import screen — so that step is current, not idle.
  const yourTurn = m.synced && awaitsReview(sync);
  return steps.map((step, index) => ({
    key: step.key, label: step.label, doneLabel: step.doneLabel,
    state: step.done ? "done" : index !== firstOpen ? "todo" : stopped ? "failed" : sync.status === "running" || yourTurn ? "current" : "todo",
  }));
}
