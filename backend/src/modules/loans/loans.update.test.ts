/**
 * Reopening a loan from the edit form, against a real MariaDB on a throwaway
 * user. Must clear the same closure fields `loanLifecycleService.reopen` clears
 * on the import-rollback path (CLAUDE.md §4). Skips when the database is down.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../config/database";
import { loansService } from "./loans.service";
import { updateLoanSchema } from "./loans.validation";

/** Its own prefix: the rollback suite wipes users by prefix and may run alongside. */
const TEST_USER_PREFIX = "__test_loan_update_";

let dbUp = false;

const CLOSED_ON = new Date(Date.UTC(2026, 2, 10));

async function dropTestUsers(): Promise<void> {
  await prisma.user.deleteMany({ where: { name: { startsWith: TEST_USER_PREFIX } } });
}

async function createUser(label: string): Promise<number> {
  const user = await prisma.user.create({ data: { name: `${TEST_USER_PREFIX}${label}` } });
  return user.id;
}

/** A loan closed by an import: every closure field filled, `paymentsMade` maxed. */
async function seedClosedLoan(userId: number) {
  return prisma.loan.create({
    data: {
      userId,
      loanName: "הלוואה 555",
      loanType: "bank",
      loanNumber: "555",
      originalAmount: 60000,
      currentBalance: 0,
      annualInterestRate: 4,
      monthlyPayment: 500,
      startDate: new Date(Date.UTC(2025, 0, 1)),
      status: "finished",
      closedAt: CLOSED_ON,
      closureReason: "early_repayment",
      closureCost: 120,
      autoClosedTransactionId: 987654,
      totalPayments: 60,
      paymentsMade: 60,
      // Bank schedule and full counts — what makes the loan read "measured".
      scheduleSource: "bank_file",
    },
  });
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

describe("עריכת הלוואה שמחזירה אותה לפעילה", () => {
  it("מאפסת את שדות הסגירה ואת מספר התשלומים שהסגירה דרסה", async ({ skip }) => {
    if (!dbUp) skip("MariaDB אינו זמין — יש להריץ bash backend/start-db.sh");
    const userId = await createUser("reopen");
    const loan = await seedClosedLoan(userId);

    // Exactly what the edit form sends: a status and the balance still owed.
    const updated = await loansService.update(
      userId,
      loan.id,
      updateLoanSchema.parse({ status: "active", currentBalance: 18000 })
    );

    expect(updated.status).toBe("active");
    // The lie this fixes: 60 of 60 paid on a debt of 18,000 ₪, stated as measured.
    expect(updated.progress.paymentsRemaining).not.toBe(0);
    expect(updated.progress.certainty).toBe("scenario");

    const after = await prisma.loan.findUniqueOrThrow({ where: { id: loan.id } });
    expect(after.closedAt).toBeNull();
    expect(after.closureReason).toBeNull();
    expect(after.closureCost).toBeNull();
    // A live loan pointing at the row that closed it is what the next sync reads.
    expect(after.autoClosedTransactionId).toBeNull();
    expect(after.paymentsMade).toBeNull();
  });

  /** `overdue` is owed just as much as `active`, so it clears the same fields. */
  it("מטפלת גם במעבר לסטטוס באיחור", async ({ skip }) => {
    if (!dbUp) skip("MariaDB אינו זמין — יש להריץ bash backend/start-db.sh");
    const userId = await createUser("overdue");
    const loan = await seedClosedLoan(userId);

    await loansService.update(
      userId,
      loan.id,
      updateLoanSchema.parse({ status: "overdue", currentBalance: 18000 })
    );

    const after = await prisma.loan.findUniqueOrThrow({ where: { id: loan.id } });
    expect(after.closedAt).toBeNull();
    expect(after.autoClosedTransactionId).toBeNull();
    expect(after.paymentsMade).toBeNull();
  });

  /**
   * The other side of the guard: renaming a closed loan is not reopening it, and
   * wiping its closure record would erase what it achieved and what it freed up.
   */
  it("לא נוגעת בשדות הסגירה כשעורכים הלוואה סגורה בלי לשנות סטטוס", async ({ skip }) => {
    if (!dbUp) skip("MariaDB אינו זמין — יש להריץ bash backend/start-db.sh");
    const userId = await createUser("rename");
    const loan = await seedClosedLoan(userId);

    await loansService.update(userId, loan.id, updateLoanSchema.parse({ loanName: "שם חדש" }));

    const after = await prisma.loan.findUniqueOrThrow({ where: { id: loan.id } });
    expect(after.loanName).toBe("שם חדש");
    expect(after.status).toBe("finished");
    expect(after.closedAt).not.toBeNull();
    expect(after.closureReason).toBe("early_repayment");
    expect(Number(after.closureCost)).toBe(120);
    expect(after.autoClosedTransactionId).toBe(987654);
    expect(after.paymentsMade).toBe(60);
  });
});
