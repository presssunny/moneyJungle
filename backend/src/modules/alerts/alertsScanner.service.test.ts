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
  HIGH_CHARGE_MIN_HISTORY_ROWS,
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

/** A date safely inside the month `n` months before the current one. */
function midMonthsAgo(n: number): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - n, 15));
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

describe("high_credit_charge", () => {
  async function seedCreditImport(
    userId: number,
    rows: Array<{ amount: number; businessName: string; date: Date; type?: string }>,
    confirmed = true
  ): Promise<void> {
    const date = rows[0].date;
    const creditImport = await prisma.creditImport.create({
      data: { userId, fileName: "test.xlsx", importMonth: date.getUTCMonth() + 1, importYear: date.getUTCFullYear(), status: confirmed ? "confirmed" : "pending" },
    });
    await prisma.creditTransaction.createMany({
      data: rows.map((r) => ({
        userId,
        creditImportId: creditImport.id,
        transactionDate: r.date,
        billingDate: r.date,
        businessName: r.businessName,
        amount: r.amount,
        transactionType: r.type ?? "regular",
      })),
    });
  }

  it("מתריע על חיוב גבוה משמעותית מהממוצע האישי בשלושת החודשים האחרונים", async ({ skip }) => {
    if (!dbUp) skip("MariaDB אינו זמין — יש להריץ bash backend/start-db.sh");
    const userId = await createUser("highcharge");
    for (let i = 0; i < HIGH_CHARGE_MIN_HISTORY_ROWS; i++) {
      await seedCreditImport(userId, [{ amount: 100, businessName: `עסק ${i}`, date: midMonthsAgo(1 + (i % 3)) }]);
    }
    await seedCreditImport(userId, [
      { amount: 90, businessName: "רגיל", date: midCurrentMonth() },
      { amount: 900, businessName: "חנות ריהוט", date: midCurrentMonth() },
    ]);

    await scanForAlerts(userId);
    const alerts = await alertsOfType(userId, "high_credit_charge");
    expect(alerts).toHaveLength(1);
    expect(alerts[0].title).toBe("חיוב גבוה מהרגיל: חנות ריהוט");
    expect(alerts[0].severity).toBe("info");

    await scanForAlerts(userId);
    expect(await alertsOfType(userId, "high_credit_charge")).toHaveLength(1);
  });

  it("לא מתריע בלי מספיק היסטוריה אישית, גם על חיוב ענק", async ({ skip }) => {
    if (!dbUp) skip("MariaDB אינו זמין — יש להריץ bash backend/start-db.sh");
    const userId = await createUser("nohistory");
    await seedCreditImport(userId, [{ amount: 5000, businessName: "חנות ריהוט", date: midCurrentMonth() }]);
    await scanForAlerts(userId);
    expect(await alertsOfType(userId, "high_credit_charge")).toHaveLength(0);
  });

  it("לא מתריע על אשראי מתגלגל (financing) או על ייבוא שלא אושר", async ({ skip }) => {
    if (!dbUp) skip("MariaDB אינו זמין — יש להריץ bash backend/start-db.sh");
    const userId = await createUser("financing");
    for (let i = 0; i < HIGH_CHARGE_MIN_HISTORY_ROWS; i++) {
      await seedCreditImport(userId, [{ amount: 100, businessName: `עסק ${i}`, date: midMonthsAgo(1 + (i % 3)) }]);
    }
    await seedCreditImport(userId, [{ amount: 5000, businessName: "אשראי מתגלגל", date: midCurrentMonth(), type: "financing" }]);
    await seedCreditImport(userId, [{ amount: 5000, businessName: "חנות לא מאושרת", date: midCurrentMonth() }], false);

    await scanForAlerts(userId);
    expect(await alertsOfType(userId, "high_credit_charge")).toHaveLength(0);
  });
});

describe("duplicate_transaction", () => {
  it("מתריע כששתי הוצאות ידניות זהות (סכום, תאריך ושם עסק) נרשמות", async ({ skip }) => {
    if (!dbUp) skip("MariaDB אינו זמין — יש להריץ bash backend/start-db.sh");
    const userId = await createUser("dupmanual");
    const date = midCurrentMonth();
    await prisma.expense.createMany({
      data: [
        { userId, amount: 150, expenseDate: date, businessName: "סופרמרקט", source: "manual" },
        { userId, amount: 150, expenseDate: date, businessName: "סופרמרקט", source: "manual" },
      ],
    });

    await scanForAlerts(userId);
    const alerts = await alertsOfType(userId, "duplicate_transaction");
    expect(alerts).toHaveLength(1);
    expect(alerts[0].title).toBe("כפילות אפשרית: סופרמרקט");
    expect(alerts[0].severity).toBe("info");

    // A third, unrelated manual expense must not create a second finding.
    await prisma.expense.create({ data: { userId, amount: 40, expenseDate: date, businessName: "אחר" } });
    await scanForAlerts(userId);
    expect(await alertsOfType(userId, "duplicate_transaction")).toHaveLength(1);
  });

  it("לא מתריע כשהשם, הסכום או התאריך שונים", async ({ skip }) => {
    if (!dbUp) skip("MariaDB אינו זמין — יש להריץ bash backend/start-db.sh");
    const userId = await createUser("nodup");
    const date = midCurrentMonth();
    await prisma.expense.createMany({
      data: [
        { userId, amount: 150, expenseDate: date, businessName: "סופרמרקט" },
        { userId, amount: 151, expenseDate: date, businessName: "סופרמרקט" },
        { userId, amount: 150, expenseDate: new Date(date.getTime() + 86400000), businessName: "סופרמרקט" },
        { userId, amount: 150, expenseDate: date, businessName: "בית קפה" },
      ],
    });
    await scanForAlerts(userId);
    expect(await alertsOfType(userId, "duplicate_transaction")).toHaveLength(0);
  });

  it("לא מתריע על שורות שנוצרו מייבוא, גם אם הן זהות — הייבוא כבר מונע כפילות בעצמו", async ({ skip }) => {
    if (!dbUp) skip("MariaDB אינו זמין — יש להריץ bash backend/start-db.sh");
    const userId = await createUser("dupimport");
    const session = await prisma.importSession.create({
      data: { userId, fileName: "expenses.xlsx", fileHash: "hash", storagePath: "/tmp/x", kind: "expense_sheet" },
    });
    const rows = await Promise.all(
      [1, 2].map((rowNumber) =>
        prisma.importRow.create({ data: { sessionId: session.id, rowNumber, original: {}, normalized: {}, candidates: [] } })
      )
    );
    const date = midCurrentMonth();
    for (const row of rows) {
      await prisma.expense.create({ data: { userId, amount: 150, expenseDate: date, businessName: "סופרמרקט", importRowId: row.id } });
    }
    await scanForAlerts(userId);
    expect(await alertsOfType(userId, "duplicate_transaction")).toHaveLength(0);
  });

  /**
   * The discriminating case: a credit-card purchase never becomes an `Expense`
   * row (read-time merge only, CLAUDE.md §4), and its bank-side settlement is
   * `credit_card_settled`, not `expense` — so a normal bank+credit import for
   * the same amount/date raises nothing here, even though the two clearly
   * "match" on amount and date.
   */
  it("ייבוא רגיל של בנק ואשראי לאותו חודש לא יוצר אף התרעת כפילות", async ({ skip }) => {
    if (!dbUp) skip("MariaDB אינו זמין — יש להריץ bash backend/start-db.sh");
    const userId = await createUser("bankcredit");
    const date = midCurrentMonth();
    const account = await prisma.bankAccount.create({ data: { userId, bankName: "test", accountName: "test" } });
    await prisma.bankTransaction.create({
      data: { userId, bankAccountId: account.id, transactionDate: date, amount: 500, type: "withdrawal", resolution: "credit_card_settled", description: "ויזה 1234" },
    });
    const card = await prisma.creditCard.create({ data: { userId, name: "test", issuer: "test", lastFour: "1234" } });
    const creditImport = await prisma.creditImport.create({
      data: { userId, fileName: "test.xlsx", importMonth: date.getUTCMonth() + 1, importYear: date.getUTCFullYear(), status: "confirmed" },
    });
    await prisma.creditTransaction.create({
      data: { userId, cardId: card.id, creditImportId: creditImport.id, transactionDate: date, billingDate: date, chargeDate: date, businessName: "סופרמרקט", amount: 500 },
    });

    await scanForAlerts(userId);
    expect(await alertsOfType(userId, "duplicate_transaction")).toHaveLength(0);
  });
});
