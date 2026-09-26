import { prisma } from "../../config/database";
import { ApiError } from "../../utils/ApiError";
import { formatILS } from "../../utils/money.utils";

export interface ActivityDescription {
  domain: string;
  action: string;
  entityId: string | null;
  summary: string;
  route: string;
}

const DOMAIN_LABELS: Record<string, string> = {
  expenses: "הוצאה", incomes: "הכנסה", loans: "הלוואה", bank: "בנק", credit: "אשראי",
  imports: "ייבוא", documents: "מסמך", reminders: "תזכורת", recurring: "תשלום קבוע",
  subscriptions: "מנוי", savings: "יעד", assets: "נכס", budgets: "תקציב", categories: "קטגוריה",
  "payment-methods": "אמצעי תשלום", family: "בן משפחה", settings: "הגדרות", alerts: "התראה",
  journey: "תמונה פיננסית", "household-assistant": "העוזר המשפחתי", crm: "ניהול משתמשים",
};

// Suffix verbs override the HTTP verb: POST /imports/sessions/:id/commit is a commit, not a create.
const SUFFIX_ACTIONS: Record<string, [string, string]> = {
  commit: ["commit", "נקלט"], complete: ["complete", "הושלם"], cancel: ["cancel", "בוטל"],
  rollback: ["rollback", "בוטל ייבוא"], undo: ["undo", "בוטלה החלטה"], confirm: ["confirm", "אושר"],
  "quick-add": ["create", "נוספה בהקלדה"], decision: ["decide", "הוחלט"], coverage: ["acknowledge", "אושר כיסוי"],
  "duplicate-reviews": ["decide", "הוחלט על כפילות"], recompute: ["recompute", "חושבה מחדש יתרה"],
};
const METHOD_ACTIONS: Record<string, [string, string]> = {
  POST: ["create", "נוסף"], PATCH: ["update", "עודכן"], PUT: ["update", "עודכן"], DELETE: ["delete", "נמחק"],
};

// Reading an alert, a check-in step or an unanswered import question changes nothing the household would look for later.
const IGNORED = [
  /^\/gate\//, /^\/household-assistant\/plan$/, /^\/alerts\/(read-all|\d+\/read)$/,
  /^\/journey\/check-in\/[^/]+$/, /^\/imports\/sessions\/[^/]+\/answers$/, /^\/activity/,
];
const APPEARANCE_KEYS = new Set(["theme", "currency", "dateFormat"]);
const ID_SEGMENT = /^(\d+|[0-9a-f]{8}-[0-9a-f-]{27,})$/i;

function nameOf(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  for (const key of ["title", "name", "businessName", "description", "fileName", "accountName"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, 80);
  }
  return null;
}

function amountOf(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const raw = (body as Record<string, unknown>).amount;
  const amount = typeof raw === "string" || typeof raw === "number" ? Number(raw) : NaN;
  return Number.isFinite(amount) ? formatILS(amount) : null;
}

/** Null when the request is not something the household would want in its history. */
export function describeMutation(method: string, path: string, requestBody: unknown, responseBody: unknown): ActivityDescription | null {
  const verb = METHOD_ACTIONS[method];
  if (!verb || IGNORED.some((pattern) => pattern.test(path))) return null;
  if (path === "/settings" && requestBody && typeof requestBody === "object" && Object.keys(requestBody).every((key) => APPEARANCE_KEYS.has(key))) return null;
  const segments = path.split("/").filter(Boolean);
  const domain = segments[0] ?? "";
  if (!domain) return null;
  const ids = segments.filter((segment) => ID_SEGMENT.test(segment));
  const last = segments[segments.length - 1];
  const [action, verbLabel] = SUFFIX_ACTIONS[last] ?? verb;
  const responseId = responseBody && typeof responseBody === "object" ? (responseBody as Record<string, unknown>).id : undefined;
  const entityId = ids[0] ?? (typeof responseId === "number" || typeof responseId === "string" ? String(responseId) : null);
  const detail = [nameOf(responseBody) ?? nameOf(requestBody), amountOf(responseBody) ?? amountOf(requestBody)].filter(Boolean).join(" · ");
  const subject = DOMAIN_LABELS[domain] ?? domain;
  const summary = `${subject} — ${verbLabel}${detail ? `: ${detail}` : entityId ? ` (#${entityId.slice(0, 8)})` : ""}`;
  return {
    domain, action, entityId: entityId?.slice(0, 64) ?? null, summary: summary.slice(0, 300),
    route: `${method} /${segments.map((segment) => (ID_SEGMENT.test(segment) ? ":id" : segment)).join("/")}`.slice(0, 160),
  };
}

export function recordActivity(userId: number, description: ActivityDescription) {
  return prisma.activityEvent.create({ data: { userId, ...description } });
}

const PAGE_SIZE = 50;
export async function listActivity(userId: number, before?: number) {
  if (before !== undefined && !(await prisma.activityEvent.findFirst({ where: { id: before, userId }, select: { id: true } }))) {
    throw ApiError.notFound("הרשומה לא נמצאה ביומן");
  }
  const rows = await prisma.activityEvent.findMany({
    where: { userId, ...(before !== undefined ? { id: { lt: before } } : {}) },
    orderBy: { id: "desc" },
    take: PAGE_SIZE + 1,
    select: { id: true, domain: true, action: true, entityId: true, summary: true, createdAt: true },
  });
  const items = rows.slice(0, PAGE_SIZE);
  return { items, nextCursor: rows.length > PAGE_SIZE ? items[items.length - 1].id : null };
}
