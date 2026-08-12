/**
 * The unified attention list. Proves dedupe in both directions: two sources
 * collide on one fact, and the merge resolves it to one line. DB cases skip
 * when MariaDB is down.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../config/database";
import {
  type AttentionCandidate,
  collectAttentionCandidates,
  mergeAttention,
} from "./attention.service";

const TEST_USER_PREFIX = "__test_attention_";

let dbUp = false;

async function dropTestUsers(): Promise<void> {
  await prisma.user.deleteMany({ where: { name: { startsWith: TEST_USER_PREFIX } } });
}

async function createUser(label: string): Promise<number> {
  const user = await prisma.user.create({ data: { name: `${TEST_USER_PREFIX}${label}` } });
  return user.id;
}

function daysFromToday(days: number): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + days));
}

function currentMonth(): { year: number; month: number } {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

/** Two charges on one day — the condition both the scanner and the forecast see. */
async function seedHeavyDay(userId: number): Promise<void> {
  const heavyDay = daysFromToday(5);
  await prisma.subscription.createMany({
    data: [
      { userId, name: "ביטוח רכב", amount: 780, billingDate: heavyDay, status: "active" },
      { userId, name: "חוג ילדים", amount: 640, billingDate: heavyDay, status: "active" },
    ],
  });
}

function previousMonth(): { year: number; month: number } {
  const { year, month } = currentMonth();
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

/** A heavy-day alert raised last month, title matching the scanner's dedupe key. */
function lastMonthHeavyDayAlert(userId: number, isRead: boolean) {
  const { year, month } = previousMonth();
  return prisma.alert.create({
    data: {
      userId,
      type: "upcoming_payment",
      title: "יום עמוס בתשלומים",
      message: "התראה שנרשמה בחודש הקודם",
      severity: "warning" as const,
      isRead,
      createdAt: new Date(Date.UTC(year, month - 1, 15)),
    },
  });
}

function candidate(overrides: Partial<AttentionCandidate> & { topic: string; priority: number }): AttentionCandidate {
  return {
    id: `c-${overrides.topic}-${overrides.priority}`,
    icon: "🔔",
    text: "טקסט",
    to: "/",
    tone: "warning",
    source: "summary",
    ...overrides,
  };
}

beforeAll(async () => {
  try {
    await prisma.user.findFirst();
    dbUp = true;
  } catch {
    dbUp = false;
  }
  if (dbUp) await dropTestUsers();
});

afterEach(async () => {
  if (dbUp) await dropTestUsers();
});

afterAll(async () => {
  if (dbUp) await dropTestUsers();
  await prisma.$disconnect().catch(() => undefined);
});

describe("mergeAttention", () => {
  it("משאיר שורה אחת לכל נושא — הזוכה הוא בעל העדיפות הנמוכה", () => {
    const items = mergeAttention([
      candidate({ topic: "upcoming_payment", priority: 45, source: "upcoming", text: "גרסת התחזית" }),
      candidate({ topic: "upcoming_payment", priority: 30, source: "alert", text: "גרסת ההתראה" }),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].text).toBe("גרסת ההתראה");
  });

  it("נושא שהמשתמשת כבר סימנה כנקרא לא חוזר בניסוח של המקור הגולמי", () => {
    const items = mergeAttention([
      candidate({ topic: "upcoming_payment", priority: 45, source: "upcoming" }),
      candidate({ topic: "upcoming_payment", priority: 30, source: "alert", dismissed: true }),
    ]);
    expect(items).toHaveLength(0);
  });

  it("ממיין לפי חומרה ואז לפי עדיפות", () => {
    const items = mergeAttention([
      candidate({ topic: "reminder-1", priority: 50, tone: "info" }),
      candidate({ topic: "credit-pending", priority: 21, tone: "warning" }),
      candidate({ topic: "bank-unresolved", priority: 0, tone: "critical" }),
      candidate({ topic: "budget", priority: 10, tone: "warning" }),
    ]);
    expect(items.map((item) => item.id)).toEqual([
      "c-bank-unresolved-0",
      "c-budget-10",
      "c-credit-pending-21",
      "c-reminder-1-50",
    ]);
  });

  it("מגביל את מספר השורות שמקורן בהתראה כדי שלא ידחקו את השורות המבניות", () => {
    const items = mergeAttention([
      candidate({ topic: "alert:a:1", priority: 30, source: "alert", tone: "critical" }),
      candidate({ topic: "alert:b:2", priority: 30, source: "alert", tone: "critical" }),
      candidate({ topic: "alert:c:3", priority: 30, source: "alert", tone: "critical" }),
      candidate({ topic: "bank-review", priority: 20, tone: "warning" }),
    ]);
    expect(items.map((item) => item.id)).toEqual(["c-alert:a:1-30", "c-alert:b:2-30", "c-bank-review-20"]);
  });
});

describe("איחוד מקורות על נתונים אמיתיים", () => {
  it("יום עמוס מזוהה בשני מקורות ומוצג פעם אחת — בגרסת ההתראה", async ({ skip }) => {
    if (!dbUp) skip("MariaDB אינו זמין — יש להריץ bash backend/start-db.sh");
    const userId = await createUser("heavy");
    await seedHeavyDay(userId);
    const { year, month } = currentMonth();

    const candidates = await collectAttentionCandidates(userId, year, month);
    const heavyDay = candidates.filter((c) => c.topic === "upcoming_payment");
    // Without the merge this is what the panel would render: the same day twice,
    // once as a persisted alert and once as the raw forecast.
    expect(heavyDay).toHaveLength(2);
    expect(heavyDay.map((c) => c.source).sort()).toEqual(["alert", "upcoming"]);

    const items = mergeAttention(candidates);
    const merged = items.filter((item) => item.id === "upcoming-heavy-day" || item.id.startsWith("alert-"));
    expect(merged).toHaveLength(1);
    expect(merged[0].id.startsWith("alert-")).toBe(true);
  });

  it("אחרי סימון ההתראה כנקראה היום העמוס לא צץ מחדש מהתחזית", async ({ skip }) => {
    if (!dbUp) skip("MariaDB אינו זמין — יש להריץ bash backend/start-db.sh");
    const userId = await createUser("dismissed");
    await seedHeavyDay(userId);
    const { year, month } = currentMonth();

    await collectAttentionCandidates(userId, year, month); // raises the alert
    await prisma.alert.updateMany({ where: { userId, type: "upcoming_payment" }, data: { isRead: true } });

    const candidates = await collectAttentionCandidates(userId, year, month);
    expect(candidates.filter((c) => c.topic === "upcoming_payment")).toHaveLength(2);
    expect(mergeAttention(candidates).filter((item) => item.id === "upcoming-heavy-day")).toHaveLength(0);
  });

  /** A dismissal must survive `alertsRepository.findAll`'s 100-row cap. */
  it("דחיית היום העמוס שורדת גם מעל 100 התראות חדשות יותר", async ({ skip }) => {
    if (!dbUp) skip("MariaDB אינו זמין — יש להריץ bash backend/start-db.sh");
    const userId = await createUser("history");
    await seedHeavyDay(userId);
    const { year, month } = currentMonth();

    await collectAttentionCandidates(userId, year, month); // raises the alert
    await prisma.alert.updateMany({ where: { userId, type: "upcoming_payment" }, data: { isRead: true } });
    await prisma.alert.createMany({
      data: Array.from({ length: 120 }, (_, i) => ({
        userId,
        type: "balance_drop",
        title: `רעש ${i}`,
        message: "התראה ישנה שנקראה",
        severity: "info" as const,
        isRead: true,
      })),
    });

    const items = mergeAttention(await collectAttentionCandidates(userId, year, month));
    expect(items.filter((item) => item.id === "upcoming-heavy-day")).toHaveLength(0);
  });

  /** An unread alert from an earlier month must not outrank this month's dismissal. */
  it("התראה ישנה שלא נקראה אינה משתלטת על נושא שכבר הושתק החודש", async ({ skip }) => {
    if (!dbUp) skip("MariaDB אינו זמין — יש להריץ bash backend/start-db.sh");
    const userId = await createUser("stale");
    await seedHeavyDay(userId);
    const { year, month } = currentMonth();

    await collectAttentionCandidates(userId, year, month); // raises this month's alert
    await prisma.alert.updateMany({ where: { userId, type: "upcoming_payment" }, data: { isRead: true } });
    const stale = await lastMonthHeavyDayAlert(userId, false);

    const items = mergeAttention(await collectAttentionCandidates(userId, year, month));
    expect(items.every((item) => item.id !== `alert-${stale.id}`)).toBe(true);
    expect(items.filter((item) => item.id === "upcoming-heavy-day")).toHaveLength(0);
  });

  it("צפייה בחודש קודם נגזרת מאותו חודש — לא מהשתקות של היום", async ({ skip }) => {
    if (!dbUp) skip("MariaDB אינו זמין — יש להריץ bash backend/start-db.sh");
    const userId = await createUser("past-month");
    await seedHeavyDay(userId);
    const { year, month } = currentMonth();
    const past = previousMonth();

    await collectAttentionCandidates(userId, year, month); // raises this month's alert
    const raisedNow = await prisma.alert.findFirstOrThrow({ where: { userId, type: "upcoming_payment" } });
    await prisma.alert.update({ where: { id: raisedNow.id }, data: { isRead: true } });

    // The fix itself: this month's alert never enters the past month's read layer.
    const pastCandidates = await collectAttentionCandidates(userId, past.year, past.month);
    expect(pastCandidates.every((c) => c.id !== `alert-${raisedNow.id}`)).toBe(true);
    // Nothing silences the topic there, so the raw source still speaks.
    expect(mergeAttention(pastCandidates).filter((item) => item.id === "upcoming-heavy-day")).toHaveLength(1);

    // A dismissal that does belong to the viewed month still silences it.
    await lastMonthHeavyDayAlert(userId, true);
    const silenced = mergeAttention(await collectAttentionCandidates(userId, past.year, past.month));
    expect(silenced.filter((item) => item.id === "upcoming-heavy-day")).toHaveLength(0);
  });

  it("יום שאינו עמוס אינו מייצר שורה בכלל — אותו סף כמו בסורק ההתראות", async ({ skip }) => {
    if (!dbUp) skip("MariaDB אינו זמין — יש להריץ bash backend/start-db.sh");
    const userId = await createUser("spread");
    await prisma.subscription.createMany({
      data: [
        { userId, name: "מנוי א", amount: 100, billingDate: daysFromToday(3), status: "active" },
        { userId, name: "מנוי ב", amount: 100, billingDate: daysFromToday(9), status: "active" },
        { userId, name: "מנוי ג", amount: 100, billingDate: daysFromToday(16), status: "active" },
      ],
    });
    const { year, month } = currentMonth();

    const candidates = await collectAttentionCandidates(userId, year, month);
    expect(candidates.filter((c) => c.topic === "upcoming_payment")).toHaveLength(0);
  });

  it("תזכורת קרובה נכנסת לרשימה, ורחוקה מהחלון אינה", async ({ skip }) => {
    if (!dbUp) skip("MariaDB אינו זמין — יש להריץ bash backend/start-db.sh");
    const userId = await createUser("reminders");
    await prisma.reminder.createMany({
      data: [
        { userId, title: "חידוש ביטוח", eventDate: daysFromToday(3), estimatedAmount: 1200 },
        { userId, title: "טסט לרכב", eventDate: daysFromToday(40) },
      ],
    });
    const { year, month } = currentMonth();

    const items = mergeAttention(await collectAttentionCandidates(userId, year, month));
    const texts = items.map((item) => item.text);
    expect(texts.some((text) => text.includes("חידוש ביטוח"))).toBe(true);
    expect(texts.some((text) => text.includes("טסט לרכב"))).toBe(false);
  });

  it("שומר על השורות המבניות שהדשבורד הציג עד היום", async ({ skip }) => {
    if (!dbUp) skip("MariaDB אינו זמין — יש להריץ bash backend/start-db.sh");
    const userId = await createUser("structural");
    await prisma.creditImport.create({
      data: { userId, fileName: "test.xlsx", importMonth: 1, importYear: 2026, status: "pending", totalTransactions: 7 },
    });
    const { year, month } = currentMonth();

    const items = mergeAttention(await collectAttentionCandidates(userId, year, month));
    const credit = items.find((item) => item.id === "credit-pending");
    expect(credit?.text).toBe("7 עסקאות אשראי ממתינות לאישור");
    expect(credit?.to).toBe("/accounts?tab=credit");
  });
});
