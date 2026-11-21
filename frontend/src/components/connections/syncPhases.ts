import type { ConnectionSync, FinancialConnection, SyncOutcomeItem, SyncPhase, SyncStage, SyncStageName, SyncStageStatus } from "../../types/models";

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
    { key: "sync", label: "מכינים את התנועות לבדיקה", doneLabel: syncedLabel(sync), done: m.synced },
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

export const isLoanSchedule = (item: SyncOutcomeItem) => item.kind === "loan_schedule";
/** Read from the bank's own pages (§7 A2): no rows, only figures and labels to approve. */
export const isSiteSnapshot = (item: SyncOutcomeItem) => item.kind === "loan_details" || item.kind === "standing_orders";
/** Absent kind = an account item stored before kinds existed. */
export const isAccountItem = (item: SyncOutcomeItem) => !item.kind || item.kind === "account";

/** The server's stage list for a bank sync; empty for a card sync or one stored before stages existed. */
export const syncStages = (sync: ConnectionSync): SyncStage[] => (sync.outcome ?? []).find((item) => item.stages)?.stages ?? [];

// Labels only: which status a stage has, and whether the sync is incomplete, is the server's rule.
export const STAGE_STATUS_LABEL: Record<SyncStageStatus, string> = {
  done: "הושלם", not_needed: "לא נדרש", failed: "נכשל", unavailable: "לא זמין", blocked: "חסום במדיניות", awaiting_approval: "ממתין לאישור",
};
export const syncedLabel = (sync: ConnectionSync) => (sync.incomplete ? "העו״ש סונכרן — חלק מהנתונים לא נאספו" : "הסנכרון הושלם");

export type StageGroup = "checking" | "loans" | "standing_orders" | "documents";
export const STAGE_GROUP_TITLE: Record<StageGroup, string> = { checking: "עו״ש", loans: "הלוואות", standing_orders: "הוראות קבע", documents: "מסמכים" };
const STAGE_GROUP: Record<SyncStageName, StageGroup> = {
  checking: "checking", loan_detection: "loans", loans_department: "loans", loan_details: "loans", loan_schedule_import: "loans",
  standing_orders_detection: "standing_orders", standing_orders_verification: "standing_orders", bank_documents: "documents",
};

/** Consecutive stages of one group, keeping the server's order. */
export function groupStages(stages: SyncStage[]): Array<{ group: StageGroup; stages: SyncStage[] }> {
  const groups: Array<{ group: StageGroup; stages: SyncStage[] }> = [];
  for (const s of stages) {
    const group = STAGE_GROUP[s.stage];
    const last = groups.at(-1);
    if (last?.group === group) last.stages.push(s);
    else groups.push({ group, stages: [s] });
  }
  return groups;
}

const STOP_TEXT: Record<string, string> = {
  SESSION_LOST: "הבנק ניתק את הכניסה", CHALLENGE: "הבנק ביקש אימות נוסף", NOT_IN_MENU: "הדף לא מופיע בתפריט",
  REDIRECT: "הבנק הפנה לדף אחר", HTTP_STATUS: "הבנק החזיר שגיאה", NEW_TAB: "נפתחה לשונית חדשה — עצרנו",
  BUDGET: "נגמר הזמן שהוקצב", NO_DECISION: "נגמר הזמן שהוקצב", CLOSED: "החלון נסגר",
};
const SKIP_REASON: Record<string, string> = {
  SCHEDULE_INCOMPLETE: "בלוח חסרים חלקים מהתשלומים", INDEX_LINKED: "מסלול צמוד מדד עוד לא נתמך", IDENTIFIER_UNREADABLE: "מספר ההלוואה או המסלול לא נקרא",
  NO_SCHEDULE: "התקבלה תמונת מצב בלי לוח תשלומים", SCHEDULE_REJECTED: "הלוח לא עבר את בדיקת התקינות", IMPORT_FAILED: "השמירה נכשלה",
};

/** A department read that did not bring data: no table on the page, a stop on the way, or a failed read. */
function failedRead(code: string | null, what: string): string {
  if (code === "UNAVAILABLE") return "הדף נפתח, אבל לא זיהינו בו טבלה מוכרת — לא נקרא דבר";
  if (code === "EXTRAS_INVALID") return `${what} התקבלו במבנה לא תקין ולא נשמרו`;
  const stop = STOP_TEXT[code ?? ""];
  return stop ? `לא הגענו לדף: ${stop} — לא ניסינו שוב` : "קריאת הדף נכשלה — לא ניסינו שוב";
}

/** "ו־3 שורות לא זוהו" / "ושורה אחת לא זוהתה", with what sits between the noun and the verb. */
const unrecognized = (rejected: number, where = "") => (rejected === 1 ? `ושורה אחת${where} לא זוהתה` : `ו־${rejected} שורות${where} לא זוהו`);

export function stageText({ stage, state, code, count = 0, rejected = 0 }: SyncStage): string {
  switch (stage) {
    case "checking": return "התנועות בעו״ש נקראו";
    case "loan_detection":
      if (state === "done") return `זוהו ${count} חיובי הלוואה`;
      if (state === "partial") return `${count} חיובי הלוואה לא שויכו להלוואה אחת — תתבקשי לבחור במסך הייבוא`;
      return "לא זוהו חיובי הלוואה בתקופה הזו";
    case "loans_department":
      if (state === "done") return "האפליקציה של הבנק עברה לדף ההלוואות";
      // ERROR is ours: the worker brought no follow-up report, so nothing says the bank refused.
      if (state === "failed" && code === "ERROR") return "המעבר לדף ההלוואות לא הושלם בגלל תקלה אצלנו — לא ניסינו שוב";
      if (state === "failed") return `לא הגענו לדף ההלוואות: ${STOP_TEXT[code ?? ""] ?? "הבנק לא הציג את הדף"} — לא ניסינו שוב`;
      if (code === "DISABLED") return "המעבר לדף ההלוואות כבוי בהגדרות, לכן לא בוצע";
      if (code === "NOT_OFFICIAL_WINDOW") return "המעבר לדף ההלוואות אפשרי רק בכניסה בחלון של הבנק";
      return "לא נדרש מעבר לדף ההלוואות";
    case "loan_details":
      // NOT_APPROVED: the loans department is not in CONNECTION_DEPARTMENT_READ, a setting, not a pending approval.
      if (state === "blocked") return "פרטי ההלוואות לא נקראו מהאתר — קריאת הדף כבויה בהגדרות. אפשר להעלות לוח סילוקין כקובץ במסך ההלוואות";
      if (state === "failed") return failedRead(code, "פרטי ההלוואות");
      if (state === "done") return `נקראו פרטים של ${count} מסלולי הלוואה מאתר הבנק — מחכים לאישורך`;
      if (code === "ROWS_UNRECOGNIZED") return `נקראו ${count} מסלולי הלוואה מאתר הבנק, ${unrecognized(rejected, " בטבלה")} — ייתכן שחסרה הלוואה. כדאי להשוות לדף הבנק`;
      return code === "NOT_RUN" ? "פרטי ההלוואות לא נקראו, כי לא הגענו לדף ההלוואות" : "לא נדרשה קריאה של פרטי הלוואות";
    case "loan_schedule_import": {
      const reason = SKIP_REASON[code ?? ""] ?? "סיבה לא ידועה";
      if (state === "done") return count ? `${count} לוחות סילוקין מחכים לאישור` : "לוחות הסילוקין האלה כבר נקלטו";
      if (state === "partial") return `חלק מהלוחות לא נשמרו: ${reason}`;
      if (state === "failed") return `לוחות הסילוקין לא נשמרו: ${reason}`;
      return "אין לוח סילוקין לשמור";
    }
    case "standing_orders_detection":
      if (state === "done") return `זוהו ${count} חיובים חוזרים מתוך העו״ש (הסקה מהתנועות — לא אומת מול הוראות הקבע בבנק)`;
      if (state === "failed") return "זיהוי החיובים החוזרים נכשל — התנועות עצמן נקלטו כרגיל";
      return code === "WINDOW_TOO_SHORT" ? "אין מספיק חודשים בעו״ש כדי לזהות חיובים חוזרים" : "לא זוהו חיובים חוזרים";
    case "standing_orders_verification":
      if (state === "done") return `נקראו ${count} הוראות קבע והרשאות מאתר הבנק — מחכות לאישורך`;
      if (code === "ROWS_UNRECOGNIZED") return `נקראו ${count} הוראות קבע מאתר הבנק, ${unrecognized(rejected)} — ייתכן שחסרה הוראה`;
      if (state === "blocked") return "הוראות הקבע וההרשאות לחיוב לא נקראו מאתר הבנק — קריאת הדף כבויה בהגדרות";
      if (state === "failed") return failedRead(code, "הוראות הקבע");
      if (code === "NOT_OFFICIAL_WINDOW") return "קריאת הוראות הקבע מאתר הבנק אפשרית רק בכניסה בחלון של הבנק";
      if (code === "NOT_RUN") return "הוראות הקבע לא נקראו מאתר הבנק בסנכרון הזה";
      return "לא נדרשה קריאה של הוראות הקבע מאתר הבנק";
    case "bank_documents":
      return "מסמכים ודוחות לא הורדו מאתר הבנק — הורדה כזו עדיין לא אושרה. אפשר להעלות קובץ במסך הייבוא";
  }
}
