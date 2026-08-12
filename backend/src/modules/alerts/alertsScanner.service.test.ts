/**
 * Alert detection, against a real MariaDB on a throwaway user. Each case proves
 * both directions: the condition raises the alert, and a rescan in the same
 * month does not raise it again (dedupe key: type|title). Skips when the
 * database is down.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../config/database";
import { monthRange } from "../../utils/date.utils";
import { buildUpcoming } from "../dashboard/cashflow.service";
import {
  AlertType,
  HEAVY_DAY_SHARE,
  scanForAlerts,
  UNCATEGORIZED_MIN_ROWS,
  UPCOMING_WINDOW_DAYS,
} from "./alertsScanner.service";

const TEST_USER_PREFIX = "__test_alerts_";

let dbUp = false;

async function dropTestUsers(): Promise<void> {
  await prisma.user.deleteMany({ where: { name: { startsWith: TEST_USER_PREFIX } } });
}

async function createUser(label: string): Promise<number> {
  const user = await prisma.user.create({ data: { name: `${TEST_USER_PREFIX}${label}` } });
  return user.id;
}

function alertsOfType(userId: number, type: AlertType) {
  return prisma.alert.findMany({ where: { userId, type }, orderBy: { id: "asc" } });
}

function daysFromToday(days: number): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + days));
}

/** A date safely inside the current month, whatever today is. */
function midCurrentMonth(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 15));
}

beforeAll(async () => {
  try {
    await prisma.user.findFirst();
    dbUp = true;
  } catch {
    dbUp = false;
  }
  // Also clears leftovers from a run that crashed before its cleanup.
  if (dbUp) await dropTestUsers();
});

afterEach(async () => {
  if (dbUp) await dropTestUsers();
});

afterAll(async () => {
  if (dbUp) await dropTestUsers();
  await prisma.$disconnect().catch(() => undefined);
});

describe("upcoming_payment", () => {
  it("מתריע כששני חיובים או יותר מתרכזים באותו יום", async ({ skip }) => {
    if (!dbUp) skip("MariaDB אינו זמין — יש להריץ bash backend/start-db.sh");
    const userId = await createUser("upcoming");
    const heavyDay = daysFromToday(5);
    await prisma.subscription.createMany({
      data: [
        { userId, name: "ביטוח רכב", amount: 780, billingDate: heavyDay, status: "active" },
        { userId, name: "חוג ילדים", amount: 640, billingDate: heavyDay, status: "active" },
      ],
    });

    await scanForAlerts(userId);
    const alerts = await alertsOfType(userId, "upcoming_payment");
    expect(alerts).toHaveLength(1);
    expect(alerts[0].title).toBe("יום עמוס בתשלומים");
    expect(alerts[0].message).toContain(`${heavyDay.getUTCDate()}/${heavyDay.getUTCMonth() + 1}`);
    expect(alerts[0].severity).toBe("warning");

    await scanForAlerts(userId);
    expect(await alertsOfType(userId, "upcoming_payment")).toHaveLength(1);
  });

  /** Regression: the title used to embed the date, breaking dedupe as the window rolls. */
  it("שתי סריקות באותו חודש עם יום כבד שונה עדיין נשארות שורה אחת", async ({ skip }) => {
    if (!dbUp) skip("MariaDB אינו זמין — יש להריץ bash backend/start-db.sh");
    const realNow = new Date();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.UTC(realNow.getUTCFullYear(), realNow.getUTCMonth(), 1, 12)));
    try {
      const userId = await createUser("rolling");
      const nearDay = daysFromToday(4);
      const farDay = daysFromToday(41);
      await prisma.subscription.createMany({
        data: [
          { userId, name: "ביטוח", amount: 900, billingDate: nearDay, status: "active" },
          { userId, name: "שכר לימוד", amount: 900, billingDate: nearDay, status: "active" },
          { userId, name: "ועד בית", amount: 400, billingDate: farDay, status: "active" },
          { userId, name: "אינטרנט", amount: 400, billingDate: farDay, status: "active" },
        ],
      });

      const upcomingBefore = await buildUpcoming(userId, UPCOMING_WINDOW_DAYS);
      await scanForAlerts(userId);
      expect(await alertsOfType(userId, "upcoming_payment")).toHaveLength(1);

      // 20 days later, still the same calendar month: nearDay has passed and
      // dropped out of the forward window, so farDay is now the heaviest day —
      // a genuinely different date than the one the first scan saw.
      vi.setSystemTime(new Date(Date.UTC(realNow.getUTCFullYear(), realNow.getUTCMonth(), 21, 12)));
      const upcomingAfter = await buildUpcoming(userId, UPCOMING_WINDOW_DAYS);
      expect(upcomingAfter.heaviestDay?.date).not.toBe(upcomingBefore.heaviestDay?.date);

      await scanForAlerts(userId);
      expect(await alertsOfType(userId, "upcoming_payment")).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  /** 26% of the 45-day window is 40% of a monthly cycle — must still alert. */
  it("מתריע גם כשהיום הכבד הוא מתחת ל־30% מכלל החלון אך מעל 30% ממחזור חודשי", async ({ skip }) => {
    if (!dbUp) skip("MariaDB אינו זמין — יש להריץ bash backend/start-db.sh");
    // Day-of-month is pinned to the 10th: near the end of a month two different
    // anchors clamp onto the same February day and merge into one heavy day.
    // Stays inside the real calendar month — dedupe filters on the row's real createdAt.
    const realNow = new Date();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.UTC(realNow.getUTCFullYear(), realNow.getUTCMonth(), 10, 12)));
    try {
      const userId = await createUser("cycle");
      const heavyDay = daysFromToday(3);
      await prisma.subscription.createMany({
        data: [
          { userId, name: "ארנונה", amount: 500, billingDate: heavyDay, status: "active" },
          { userId, name: "חשמל", amount: 500, billingDate: heavyDay, status: "active" },
          { userId, name: "מנוי א", amount: 300, billingDate: daysFromToday(5), status: "active" },
          { userId, name: "מנוי ב", amount: 300, billingDate: daysFromToday(7), status: "active" },
          { userId, name: "מנוי ג", amount: 300, billingDate: daysFromToday(9), status: "active" },
        ],
      });

      const upcoming = await buildUpcoming(userId, UPCOMING_WINDOW_DAYS);
      expect(upcoming.heaviestDay).not.toBeNull();
      const windowShare = upcoming.heaviestDay!.total / upcoming.total;
      expect(windowShare).toBeLessThan(HEAVY_DAY_SHARE);
      expect(windowShare).toBeGreaterThan(HEAVY_DAY_SHARE * (30 / UPCOMING_WINDOW_DAYS));

      await scanForAlerts(userId);
      expect(await alertsOfType(userId, "upcoming_payment")).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("לא מתריע כשהחיובים פרוסים על ימים שונים", async ({ skip }) => {
    if (!dbUp) skip("MariaDB אינו זמין — יש להריץ bash backend/start-db.sh");
    const userId = await createUser("spread");
    await prisma.subscription.createMany({
      data: [
        { userId, name: "מנוי א", amount: 100, billingDate: daysFromToday(3), status: "active" },
        { userId, name: "מנוי ב", amount: 100, billingDate: daysFromToday(9), status: "active" },
        { userId, name: "מנוי ג", amount: 100, billingDate: daysFromToday(16), status: "active" },
      ],
    });

    await scanForAlerts(userId);
    expect(await alertsOfType(userId, "upcoming_payment")).toHaveLength(0);
  });
});

describe("uncategorized_expense", () => {
  /** Manual expenses + one confirmed credit row, all without a category. */
  async function seedUncategorized(userId: number, expenseCount: number): Promise<void> {
    const date = midCurrentMonth();
    await prisma.expense.createMany({
      data: Array.from({ length: expenseCount }, (_, i) => ({
        userId,
        amount: 120 + i,
        expenseDate: date,
        businessName: `עסק ${i}`,
        categoryId: null,
      })),
    });
    const { start } = monthRange(date.getUTCFullYear(), date.getUTCMonth() + 1);
    const creditImport = await prisma.creditImport.create({
      data: {
        userId,
        fileName: "test.xlsx",
        importMonth: start.getUTCMonth() + 1,
        importYear: start.getUTCFullYear(),
        status: "confirmed",
      },
    });
    await prisma.creditTransaction.createMany({
      data: [
        {
          userId,
          creditImportId: creditImport.id,
          transactionDate: date,
          billingDate: date,
          businessName: "סופר",
          amount: 200,
          categoryId: null,
        },
        // Rolling-credit financing is excluded from spend everywhere (CLAUDE.md §5),
        // so it must not inflate the count either.
        {
          userId,
          creditImportId: creditImport.id,
          transactionDate: date,
          billingDate: date,
          businessName: "פריסת אשראי",
          amount: 900,
          categoryId: null,
          transactionType: "financing",
        },
      ],
    });
  }

  it("סופר את השורות חסרות הקטגוריה מהתצוגה הממוזגת, בלי financing", async ({ skip }) => {
    if (!dbUp) skip("MariaDB אינו זמין — יש להריץ bash backend/start-db.sh");
    const userId = await createUser("uncat");
    await seedUncategorized(userId, UNCATEGORIZED_MIN_ROWS - 1);

    await scanForAlerts(userId);
    const alerts = await alertsOfType(userId, "uncategorized_expense");
    expect(alerts).toHaveLength(1);
    expect(alerts[0].title).toBe("הוצאות ללא קטגוריה");
    expect(alerts[0].message.startsWith(`${UNCATEGORIZED_MIN_ROWS} הוצאות`)).toBe(true);

    // A changed count must not create a second row: the count lives in the
    // message, so the dedupe key stays the same.
    await prisma.expense.create({
      data: { userId, amount: 77, expenseDate: midCurrentMonth(), businessName: "עוד עסק" },
    });
    await scanForAlerts(userId);
    expect(await alertsOfType(userId, "uncategorized_expense")).toHaveLength(1);
  });

  it("לא מתריע מתחת לסף ולא על שורות מסווגות", async ({ skip }) => {
    if (!dbUp) skip("MariaDB אינו זמין — יש להריץ bash backend/start-db.sh");
    const userId = await createUser("categorized");
    const category = await prisma.category.create({
      data: { userId, name: "__test_alerts_קטגוריה", type: "expense" },
    });
    await prisma.expense.createMany({
      data: Array.from({ length: UNCATEGORIZED_MIN_ROWS + 3 }, () => ({
        userId,
        amount: 100,
        expenseDate: midCurrentMonth(),
        categoryId: category.id,
      })),
    });

    await scanForAlerts(userId);
    expect(await alertsOfType(userId, "uncategorized_expense")).toHaveLength(0);
  });
});
