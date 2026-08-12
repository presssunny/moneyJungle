/**
 * Undo of an import, against a real MariaDB on a throwaway user. Rollback must
 * delete exactly the rows its own file created — an overlapping statement must
 * come out untouched. Skips when the database is down.
 */
import { rmdir } from "node:fs/promises";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../config/database";
import { hasFixture, readFixture } from "../../testing/fixtures";
import { bankService } from "../bank/bank.service";
import { loanLifecycleService } from "../loans/loanLifecycle.service";
import { loansService } from "../loans/loans.service";
import { closeLoanSchema } from "../loans/loans.validation";
import { documentsService } from "./documents.service";
import { documentStorage } from "./documentStorage.service";

const TEST_USER_PREFIX = "__test_rollback_";

let dbUp = false;

/** Only the ones this suite made — the storage root holds real users' files too. */
const createdUserIds: number[] = [];

async function dropTestUsers(): Promise<void> {
  await prisma.user.deleteMany({ where: { name: { startsWith: TEST_USER_PREFIX } } });
}

async function createUser(label: string): Promise<number> {
  const user = await prisma.user.create({ data: { name: `${TEST_USER_PREFIX}${label}` } });
  createdUserIds.push(user.id);
  return user.id;
}

const DAY = new Date(Date.UTC(2026, 2, 10));

/** One statement, its rows, the money they produced, and the document for it. */
async function importBankStatement(
  userId: number,
  fileName: string,
  opts: { withManualExclusion?: boolean; accountId?: number } = {}
) {
  const account =
    opts.accountId !== undefined
      ? { id: opts.accountId }
      : await prisma.bankAccount.create({
          data: { userId, bankName: "בנק בדיקה", accountName: `חשבון ${fileName}` },
        });
  const statement = await prisma.bankStatementImport.create({
    data: {
      userId,
      bankAccountId: account.id,
      fileName,
      fileHash: `hash-${fileName}`,
      coverageFrom: DAY,
      coverageTo: DAY,
      parsedRows: 2,
      importedRows: 2,
    },
  });
  const income = await prisma.income.create({
    data: { userId, amount: 7000, type: "salary", description: "משכורת", incomeDate: DAY },
  });
  const expense = await prisma.expense.create({
    data: { userId, amount: 250, description: "סופר", expenseDate: DAY, source: "bank_import" },
  });
  await prisma.bankTransaction.create({
    data: {
      userId,
      bankAccountId: account.id,
      statementImportId: statement.id,
      transactionDate: DAY,
      description: "משכורת",
      amount: 7000,
      type: "deposit",
      resolution: "income",
      reconcileStatus: "done",
      linkedIncomeId: income.id,
    },
  });
  await prisma.bankTransaction.create({
    data: {
      userId,
      bankAccountId: account.id,
      statementImportId: statement.id,
      transactionDate: DAY,
      description: "סופר",
      amount: 250,
      type: "withdrawal",
      resolution: "expense",
      reconcileStatus: "done",
      linkedExpenseId: expense.id,
    },
  });
  if (opts.withManualExclusion) {
    await prisma.bankTransaction.create({
      data: {
        userId,
        bankAccountId: account.id,
        statementImportId: statement.id,
        transactionDate: DAY,
        description: "העברה פנימית",
        amount: 900,
        type: "withdrawal",
        resolution: "manual_excluded",
        reconcileStatus: "excluded",
      },
    });
  }
  const document = await prisma.document.create({
    data: {
      userId,
      fileName,
      fileHash: `hash-${fileName}`,
      kind: "bank_statement",
      linkedAccountId: account.id,
      linkedStatementImportId: statement.id,
      rowsImported: 2,
    },
  });
  return { account, statement, document, income, expense };
}

/**
 * A loan and the principal row that clears it exactly — what makes
 * `syncFromStatement` close it, and therefore what a rollback has to undo.
 */
async function seedLoanPayoff(
  userId: number,
  accountId: number,
  statementImportId: number,
  opts: {
    loanNumber: string;
    balance: number;
    linkToLoan?: boolean;
    /** Makes the loan read as `measured` while its payment counts are intact. */
    scheduleSource?: string;
  }
) {
  const loan = await prisma.loan.create({
    data: {
      userId,
      loanName: `הלוואה ${opts.loanNumber}`,
      loanType: "bank",
      loanNumber: opts.loanNumber,
      originalAmount: opts.balance * 2,
      currentBalance: opts.balance,
      annualInterestRate: 4,
      monthlyPayment: 500,
      startDate: new Date(Date.UTC(2025, 0, 1)),
      totalPayments: 60,
      paymentsMade: 20,
      scheduleSource: opts.scheduleSource ?? "computed",
    },
  });
  const row = await prisma.bankTransaction.create({
    data: {
      userId,
      bankAccountId: accountId,
      statementImportId,
      transactionDate: DAY,
      description: `הלוואה - תשלום קרן ${opts.loanNumber}`,
      amount: opts.balance,
      type: "withdrawal",
      lineKind: "loan_principal",
      loanRef: opts.loanNumber,
      resolution: "debt_reduction",
      reconcileStatus: "done",
      linkedLoanId: opts.linkToLoan ? loan.id : null,
    },
  });
  return { loan, row };
}

async function importCreditReport(userId: number, fileName: string) {
  const creditImport = await prisma.creditImport.create({
    data: { userId, fileName, importMonth: 3, importYear: 2026, totalTransactions: 2 },
  });
  for (const business of ["חנות א", "חנות ב"]) {
    await prisma.creditTransaction.create({
      data: {
        userId,
        creditImportId: creditImport.id,
        transactionDate: DAY,
        billingDate: DAY,
        businessName: business,
        amount: 120,
      },
    });
  }
  const document = await prisma.document.create({
    data: {
      userId,
      fileName,
      fileHash: `hash-${fileName}`,
      kind: "credit_report",
      linkedCreditImportId: creditImport.id,
      rowsImported: 2,
    },
  });
  return { creditImport, document };
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
  // The files are removed as they are made; the per-user directory is not, and a
  // run a day would otherwise leave a directory a day behind on disk forever.
  for (const userId of createdUserIds) {
    const dir = documentStorage.resolve(String(userId));
    if (dir) await rmdir(dir).catch(() => undefined);
  }
  await prisma.$disconnect().catch(() => undefined);
});

describe("ביטול ייבוא של דף חשבון בנק", () => {
  it("מוחק את התנועות ואת ההכנסה/הוצאה שנוצרו מהן, ומסמן את המסמך", async ({ skip }) => {
    if (!dbUp) skip("MariaDB אינו זמין — יש להריץ bash backend/start-db.sh");
    const userId = await createUser("bank");
    const { statement, document, income, expense } = await importBankStatement(userId, "march.xlsx");

    const result = await documentsService.rollback(userId, document.id);

    expect(result.removedTransactions).toBe(2);
    expect(result.removedIncomes).toBe(1);
    expect(result.removedExpenses).toBe(1);
    expect(await prisma.bankTransaction.count({ where: { userId } })).toBe(0);
    expect(await prisma.income.findUnique({ where: { id: income.id } })).toBeNull();
    expect(await prisma.expense.findUnique({ where: { id: expense.id } })).toBeNull();
    expect(await prisma.bankStatementImport.findUnique({ where: { id: statement.id } })).toBeNull();
    // Nothing else covers these days, so there is nothing to warn about.
    expect(result.overlappingImports).toEqual([]);

    // The document survives on purpose: it is the record that the import happened.
    const after = await prisma.document.findUnique({ where: { id: document.id } });
    expect(after?.status).toBe("rolled_back");
  });

  /** Two files, same account, same days — the case `statementImportId` exists for. */
  it("לא נוגע בייבוא אחר באותו חשבון שמכסה בדיוק את אותם ימים", async ({ skip }) => {
    if (!dbUp) skip("MariaDB אינו זמין — יש להריץ bash backend/start-db.sh");
    const userId = await createUser("two_files");
    const first = await importBankStatement(userId, "first.xlsx");
    const second = await importBankStatement(userId, "second.xlsx", {
      accountId: first.account.id,
    });

    const result = await documentsService.rollback(userId, first.document.id);

    // Silent loss is the thing to prevent: the second file's own rows survive,
    // but any row BOTH files carried was deduped into this batch and left with it.
    expect(result.overlappingImports).toEqual([
      { fileName: "second.xlsx", coverageFrom: "2026-03-10", coverageTo: "2026-03-10" },
    ]);
    expect(result.message).toContain("second.xlsx");

    const survivors = await prisma.bankTransaction.findMany({ where: { userId } });
    expect(survivors).toHaveLength(2);
    expect(survivors.every((row) => row.statementImportId === second.statement.id)).toBe(true);
    expect(await prisma.income.findUnique({ where: { id: second.income.id } })).not.toBeNull();
    expect(await prisma.expense.findUnique({ where: { id: second.expense.id } })).not.toBeNull();
    const untouched = await prisma.document.findUnique({ where: { id: second.document.id } });
    expect(untouched?.status).toBe("imported");
  });

  it("שומר שורה שהמשתמשת החריגה ידנית ומנתק אותה מהייבוא", async ({ skip }) => {
    if (!dbUp) skip("MariaDB אינו זמין — יש להריץ bash backend/start-db.sh");
    const userId = await createUser("manual");
    const { document } = await importBankStatement(userId, "manual.xlsx", {
      withManualExclusion: true,
    });

    const result = await documentsService.rollback(userId, document.id);

    expect(result.keptManual).toBe(1);
    const survivors = await prisma.bankTransaction.findMany({ where: { userId } });
    expect(survivors).toHaveLength(1);
    expect(survivors[0]?.resolution).toBe("manual_excluded");
    expect(survivors[0]?.statementImportId).toBeNull();
  });

  /** A loan link is hand work too, same treatment as an exclusion; the Loan stays. */
  it("שומר שורה שקושרה ידנית להלוואה, ומשאיר את ההלוואה קיימת", async ({ skip }) => {
    if (!dbUp) skip("MariaDB אינו זמין — יש להריץ bash backend/start-db.sh");
    const userId = await createUser("linked");
    const { account, statement, document } = await importBankStatement(userId, "linked.xlsx");
    const { loan, row } = await seedLoanPayoff(userId, account.id, statement.id, {
      loanNumber: "901",
      balance: 4200,
      linkToLoan: true,
    });

    const result = await documentsService.rollback(userId, document.id);

    expect(result.keptLinked).toBe(1);
    const survivor = await prisma.bankTransaction.findUnique({ where: { id: row.id } });
    expect(survivor?.statementImportId).toBeNull();
    expect(survivor?.linkedLoanId).toBe(loan.id);
    expect(await prisma.loan.findUnique({ where: { id: loan.id } })).not.toBeNull();
  });
});

/**
 * A closure a statement caused must be undone with its import. Matched by
 * `autoClosedTransactionId` — an identity, not a closest-balance guess.
 */
describe("ביטול שמחזיר הלוואה שנסגרה אוטומטית", () => {
  it("פותח מחדש את ההלוואה עם היתרה שהשורה שנמחקה סגרה", async ({ skip }) => {
    if (!dbUp) skip("MariaDB אינו זמין — יש להריץ bash backend/start-db.sh");
    const userId = await createUser("reopen");
    const { account, statement, document } = await importBankStatement(userId, "payoff.xlsx");
    const { loan, row } = await seedLoanPayoff(userId, account.id, statement.id, {
      loanNumber: "777",
      balance: 12345.67,
    });

    const events = await loanLifecycleService.syncFromStatement(userId);
    expect(events).toHaveLength(1);
    const closed = await prisma.loan.findUniqueOrThrow({ where: { id: loan.id } });
    expect(closed.status).toBe("finished");
    // The row that did it, recorded at the moment it did — the whole mechanism.
    expect(closed.autoClosedTransactionId).toBe(row.id);
    // The instalments an early payoff never made are not now "made".
    expect(closed.paymentsMade).toBe(20);

    const result = await documentsService.rollback(userId, document.id);

    expect(result.reopenedLoans).toEqual([{ loanName: "הלוואה 777", balance: 12345.67 }]);
    expect(result.unresolvedClosedLoans).toEqual([]);
    const reopened = await prisma.loan.findUniqueOrThrow({ where: { id: loan.id } });
    expect(reopened.status).toBe("active");
    expect(Number(reopened.currentBalance)).toBe(12345.67);
    expect(reopened.closedAt).toBeNull();
    expect(reopened.closureReason).toBeNull();
    expect(reopened.closureCost).toBeNull();
    // The pointer goes with the row: an active loan closed by a deleted row is
    // a claim nothing backs, and the next sync reads this column.
    expect(reopened.autoClosedTransactionId).toBeNull();
    // No schedule to count off, and `paymentsMade` was never maxed out — 20 is
    // a real figure the closure preserved, so nulling it would lose data.
    expect(reopened.paymentsMade).toBe(20);

    // And it stays open: the row that closed it is gone, so the next sync — which
    // every load of the loans screen runs — has nothing to close it with again.
    await loanLifecycleService.syncFromStatement(userId);
    const stillOpen = await prisma.loan.findUniqueOrThrow({ where: { id: loan.id } });
    expect(stillOpen.status).toBe("active");
    expect(Number(stillOpen.currentBalance)).toBe(12345.67);
  });

  /**
   * One bank loan number, two tracks, both paid off the same day ("108" = 432 +
   * 562). Each track must get back its own debt, not share one restored payment.
   */
  it("מחזיר לכל מסלול את היתרה שלו כששני מסלולים באותו מספר נסגרו יחד", async ({ skip }) => {
    if (!dbUp) skip("MariaDB אינו זמין — יש להריץ bash backend/start-db.sh");
    const userId = await createUser("tracks");
    const { account, statement, document } = await importBankStatement(userId, "tracks.xlsx");
    // The smaller debt first on purpose: without the schedule to go by, the
    // fallback hands it the larger payment, and this test says so.
    const tracks = [
      { trackNumber: "432", balance: 155.09 },
      { trackNumber: "562", balance: 198.4 },
    ];
    const loans = [];
    for (const track of tracks) {
      const loan = await prisma.loan.create({
        data: {
          userId,
          loanName: `הלוואה 108 מסלול ${track.trackNumber}`,
          loanType: "bank",
          loanNumber: "108",
          trackNumber: track.trackNumber,
          originalAmount: track.balance * 3,
          currentBalance: track.balance,
          annualInterestRate: 4,
          monthlyPayment: 100,
          startDate: new Date(Date.UTC(2025, 0, 1)),
          scheduleSource: "bank_file",
        },
      });
      // Two instalments before the payoff day and the payoff itself. The two are
      // what `paymentsMade` has to come back as when the closure is undone.
      for (const [offset, entry] of [
        { month: 0, principal: 10 },
        { month: 1, principal: 10 },
        { month: 2, principal: track.balance },
      ].entries()) {
        await prisma.loanScheduleEntry.create({
          data: {
            loanId: loan.id,
            paymentNumber: offset + 1,
            paymentDate: new Date(Date.UTC(2026, entry.month, 10)),
            principal: entry.principal,
            interest: 0,
            total: entry.principal,
            balanceAfter: 0,
          },
        });
      }
      await prisma.bankTransaction.create({
        data: {
          userId,
          bankAccountId: account.id,
          statementImportId: statement.id,
          transactionDate: DAY,
          description: "הלוואה - תשלום קרן 108",
          amount: track.balance,
          type: "withdrawal",
          lineKind: "loan_principal",
          loanRef: "108",
          resolution: "debt_reduction",
          reconcileStatus: "done",
        },
      });
      loans.push(loan);
    }

    expect(await loanLifecycleService.syncFromStatement(userId)).toHaveLength(2);

    // Each track recorded its own row, and no row was used twice.
    const markers = await prisma.loan.findMany({
      where: { userId },
      select: { autoClosedTransactionId: true },
    });
    const markerIds = markers.map((loan) => loan.autoClosedTransactionId);
    expect(markerIds.every((id) => id !== null)).toBe(true);
    expect(new Set(markerIds).size).toBe(2);

    const result = await documentsService.rollback(userId, document.id);

    expect(result.reopenedLoans).toHaveLength(2);
    expect(result.unresolvedClosedLoans).toEqual([]);
    for (const [index, loan] of loans.entries()) {
      const after = await prisma.loan.findUniqueOrThrow({ where: { id: loan.id } });
      expect(after.status).toBe("active");
      expect(Number(after.currentBalance)).toBe(tracks[index]!.balance);
      // Counted off the schedule, not reset: two instalments fell before the payoff.
      expect(after.paymentsMade).toBe(2);
    }
  });

  /**
   * Two tracks of one loan number, each closed by its own row in a different
   * file — undoing one file must reopen only the track it closed.
   */
  it("פותח רק את המסלול שהשורה שנמחקה סגרה, ולא את אחיו באותו מספר", async ({ skip }) => {
    if (!dbUp) skip("MariaDB אינו זמין — יש להריץ bash backend/start-db.sh");
    const userId = await createUser("tracks_partial");
    const first = await importBankStatement(userId, "track-a.xlsx");
    const second = await importBankStatement(userId, "track-b.xlsx", {
      accountId: first.account.id,
    });

    const batches = [
      { statementId: first.statement.id, balance: 198.4 },
      { statementId: second.statement.id, balance: 155.09 },
    ];
    const loans = [];
    for (const [index, batch] of batches.entries()) {
      loans.push(
        await prisma.loan.create({
          data: {
            userId,
            loanName: `מסלול ${index}`,
            loanType: "bank",
            loanNumber: "108",
            originalAmount: batch.balance * 3,
            currentBalance: batch.balance,
            annualInterestRate: 4,
            monthlyPayment: 100,
            startDate: new Date(Date.UTC(2025, 0, 1)),
          },
        })
      );
      await prisma.bankTransaction.create({
        data: {
          userId,
          bankAccountId: first.account.id,
          statementImportId: batch.statementId,
          transactionDate: DAY,
          description: "הלוואה - תשלום קרן 108",
          amount: batch.balance,
          type: "withdrawal",
          lineKind: "loan_principal",
          loanRef: "108",
          resolution: "debt_reduction",
          reconcileStatus: "done",
        },
      });
    }
    expect(await loanLifecycleService.syncFromStatement(userId)).toHaveLength(2);
    const [closedA, closedB] = [
      await prisma.loan.findUniqueOrThrow({ where: { id: loans[0]!.id } }),
      await prisma.loan.findUniqueOrThrow({ where: { id: loans[1]!.id } }),
    ];
    expect(closedA.autoClosedTransactionId).not.toBe(closedB.autoClosedTransactionId);

    const result = await documentsService.rollback(userId, first.document.id);

    // Exactly one track comes back, named and with its own balance. Nothing is
    // hedged, because nothing was guessed.
    expect(result.reopenedLoans).toEqual([{ loanName: "מסלול 0", balance: 198.4 }]);
    expect(result.unresolvedClosedLoans).toEqual([]);
    const afterA = await prisma.loan.findUniqueOrThrow({ where: { id: loans[0]!.id } });
    expect(afterA.status).toBe("active");
    expect(Number(afterA.currentBalance)).toBe(198.4);
    const afterB = await prisma.loan.findUniqueOrThrow({ where: { id: loans[1]!.id } });
    expect(afterB.status).toBe("finished");
    expect(Number(afterB.currentBalance)).toBe(0);
    expect(afterB.autoClosedTransactionId).toBe(closedB.autoClosedTransactionId);
  });

  /** Two tracks with identical balances and one payoff row must not both claim it. */
  it("שורה אחת סוגרת מסלול אחד בלבד, גם כששני מסלולים באותה יתרה בדיוק", async ({ skip }) => {
    if (!dbUp) skip("MariaDB אינו זמין — יש להריץ bash backend/start-db.sh");
    const userId = await createUser("tracks_identical");
    const { account, statement, document } = await importBankStatement(userId, "identical.xlsx");
    for (const index of [0, 1]) {
      await prisma.loan.create({
        data: {
          userId,
          loanName: `מסלול זהה ${index}`,
          loanType: "bank",
          loanNumber: "109",
          originalAmount: 1000,
          currentBalance: 250,
          annualInterestRate: 4,
          monthlyPayment: 100,
          startDate: new Date(Date.UTC(2025, 0, 1)),
        },
      });
    }
    await prisma.bankTransaction.create({
      data: {
        userId,
        bankAccountId: account.id,
        statementImportId: statement.id,
        transactionDate: DAY,
        description: "הלוואה - תשלום קרן 109",
        amount: 250,
        type: "withdrawal",
        lineKind: "loan_principal",
        loanRef: "109",
        resolution: "debt_reduction",
        reconcileStatus: "done",
      },
    });

    expect(await loanLifecycleService.syncFromStatement(userId)).toHaveLength(1);
    // Running again must not let the second track claim the same row.
    expect(await loanLifecycleService.syncFromStatement(userId)).toHaveLength(0);

    const result = await documentsService.rollback(userId, document.id);

    expect(result.reopenedLoans).toHaveLength(1);
    expect(result.reopenedLoans[0]?.balance).toBe(250);
    const balances = await prisma.loan.findMany({
      where: { userId },
      select: { currentBalance: true, status: true },
    });
    // One was never closed and still owes 250; the other is owed again — not 500
    // handed out twice, which is what the old amount match would have done.
    expect(balances.map((loan) => Number(loan.currentBalance))).toEqual([250, 250]);
    expect(balances.every((loan) => loan.status === "active")).toBe(true);
  });

  /**
   * A hand closure can share a reason and date with a row being deleted, but it
   * never wrote a row id — that's what keeps it closed.
   */
  it("לא נוגע בהלוואה שהמשתמשת סגרה בעצמה, גם כשהסיבה והתאריך זהים לשורה שנמחקת", async ({
    skip,
  }) => {
    if (!dbUp) skip("MariaDB אינו זמין — יש להריץ bash backend/start-db.sh");
    const userId = await createUser("manual_close");
    const { account, statement, document } = await importBankStatement(userId, "manual-close.xlsx");
    const { loan } = await seedLoanPayoff(userId, account.id, statement.id, {
      loanNumber: "778",
      balance: 900,
    });
    // Through the real endpoint's path, with the schema's own default reason.
    await loanLifecycleService.close(loan.id, {
      closedAt: DAY,
      reason: closeLoanSchema.parse({ closedAt: DAY }).reason,
      closureCost: null,
    });
    const closed = await prisma.loan.findUniqueOrThrow({ where: { id: loan.id } });
    expect(closed.closureReason).toBe("early_repayment");
    expect(closed.autoClosedTransactionId).toBeNull();

    const result = await documentsService.rollback(userId, document.id);

    expect(result.reopenedLoans).toEqual([]);
    const after = await prisma.loan.findUniqueOrThrow({ where: { id: loan.id } });
    expect(after.status).toBe("finished");
    expect(Number(after.currentBalance)).toBe(0);
    // Not reopened, and not passed over in silence either.
    expect(result.unresolvedClosedLoans).toEqual([
      { loanName: "הלוואה 778", loanNumber: "778" },
    ]);
    expect(result.message).toContain("778");
  });

  /** Closed before this column existed: reported, not reopened on a guessed balance. */
  it("הלוואה סגורה בלי סימון מקור נשארת סגורה ומדווחת לבדיקה ידנית", async ({ skip }) => {
    if (!dbUp) skip("MariaDB אינו זמין — יש להריץ bash backend/start-db.sh");
    const userId = await createUser("legacy_marker");
    const { account, statement, document } = await importBankStatement(userId, "legacy-marker.xlsx");
    const { loan } = await seedLoanPayoff(userId, account.id, statement.id, {
      loanNumber: "781",
      balance: 2500,
    });
    await prisma.loan.update({
      where: { id: loan.id },
      data: {
        status: "finished",
        currentBalance: 0,
        closedAt: DAY,
        closureReason: "early_repayment",
        autoClosedTransactionId: null,
      },
    });

    const result = await documentsService.rollback(userId, document.id);

    expect(result.reopenedLoans).toEqual([]);
    expect(result.unresolvedClosedLoans).toEqual([
      { loanName: "הלוואה 781", loanNumber: "781" },
    ]);
    const after = await prisma.loan.findUniqueOrThrow({ where: { id: loan.id } });
    expect(after.status).toBe("finished");
    expect(Number(after.currentBalance)).toBe(0);
    expect(after.paymentsMade).toBe(20);
  });

  /**
   * A closure that left `paymentsMade` maxed at `totalPayments` must clear it on
   * reopen, dropping certainty to "scenario".
   */
  it("מנקה מספר תשלומים שנדרס בסגירה ישנה, ומוריד את הוודאות ל״תרחיש״", async ({
    skip,
  }) => {
    if (!dbUp) skip("MariaDB אינו זמין — יש להריץ bash backend/start-db.sh");
    const userId = await createUser("legacy_payments");
    const { account, statement, document } = await importBankStatement(userId, "legacy.xlsx");
    const { loan, row } = await seedLoanPayoff(userId, account.id, statement.id, {
      loanNumber: "780",
      balance: 3300,
      // Bank schedule and real counts — "measured" until the reopen loses them.
      scheduleSource: "bank_file",
    });
    await prisma.loan.update({
      where: { id: loan.id },
      data: {
        status: "finished",
        currentBalance: 0,
        closedAt: DAY,
        closureReason: "early_repayment",
        autoClosedTransactionId: row.id,
        paymentsMade: 60, // what the old closure wrote: totalPayments
      },
    });

    // Measured while it was closed — the loan is what the reopen degrades.
    const before = await loansService.list(userId);
    expect(before.loans.find((l) => l.id === loan.id)?.progress.certainty).toBe("measured");

    await documentsService.rollback(userId, document.id);

    const reopened = await prisma.loan.findUniqueOrThrow({ where: { id: loan.id } });
    expect(reopened.status).toBe("active");
    expect(Number(reopened.currentBalance)).toBe(3300);
    expect(reopened.paymentsMade).toBeNull();
    // The number of payments left now comes out of the Spitzer simulation, so the
    // screen may no longer call it measured — the banker's "פער כנות".
    const after = await loansService.list(userId);
    expect(after.loans.find((l) => l.id === loan.id)?.progress.certainty).toBe("scenario");
  });

  /** A closure whose own row is not in this batch — that import still stands. */
  it("לא פותח מחדש הלוואה שנסגרה בגלל שורה מייבוא אחר", async ({ skip }) => {
    if (!dbUp) skip("MariaDB אינו זמין — יש להריץ bash backend/start-db.sh");
    const userId = await createUser("other_batch");
    const doomed = await importBankStatement(userId, "other-batch.xlsx");
    const survivor = await importBankStatement(userId, "keeps-the-payoff.xlsx", {
      accountId: doomed.account.id,
    });
    // The loan is paid off by a row in the batch that stays; the batch that goes
    // carries an instalment on the same loan number, which is not what closed it.
    const { loan } = await seedLoanPayoff(userId, survivor.account.id, survivor.statement.id, {
      loanNumber: "779",
      balance: 900,
    });
    await prisma.bankTransaction.create({
      data: {
        userId,
        bankAccountId: doomed.account.id,
        statementImportId: doomed.statement.id,
        transactionDate: DAY,
        description: "הלוואה - תשלום קרן 779",
        amount: 12,
        type: "withdrawal",
        lineKind: "loan_principal",
        loanRef: "779",
        resolution: "debt_reduction",
        reconcileStatus: "done",
      },
    });
    await loanLifecycleService.syncFromStatement(userId);
    const closed = await prisma.loan.findUniqueOrThrow({ where: { id: loan.id } });
    expect(closed.status).toBe("finished");

    const result = await documentsService.rollback(userId, doomed.document.id);

    expect(result.reopenedLoans).toEqual([]);
    // Its provenance is known and elsewhere, so there is nothing to warn about.
    expect(result.unresolvedClosedLoans).toEqual([]);
    const after = await prisma.loan.findUniqueOrThrow({ where: { id: loan.id } });
    expect(after.status).toBe("finished");
    expect(after.autoClosedTransactionId).toBe(closed.autoClosedTransactionId);
  });

  /** Same as above, but the marked row was since deleted by hand — reported, not skipped. */
  it("מדווח על הלוואה שסומנה בשורה שנמחקה ידנית, במקום לדלג עליה בשקט", async ({ skip }) => {
    if (!dbUp) skip("MariaDB אינו זמין — יש להריץ bash backend/start-db.sh");
    const userId = await createUser("dangling_marker");
    const doomed = await importBankStatement(userId, "dangling.xlsx");
    const survivor = await importBankStatement(userId, "held-the-payoff.xlsx", {
      accountId: doomed.account.id,
    });
    const { loan, row } = await seedLoanPayoff(userId, survivor.account.id, survivor.statement.id, {
      loanNumber: "782",
      balance: 900,
    });
    // The batch on its way out carries an instalment on the same loan number —
    // which is what brings this loan into `findClosedBy` at all.
    await prisma.bankTransaction.create({
      data: {
        userId,
        bankAccountId: doomed.account.id,
        statementImportId: doomed.statement.id,
        transactionDate: DAY,
        description: "הלוואה - תשלום קרן 782",
        amount: 12,
        type: "withdrawal",
        lineKind: "loan_principal",
        loanRef: "782",
        resolution: "debt_reduction",
        reconcileStatus: "done",
      },
    });
    await loanLifecycleService.syncFromStatement(userId);
    const closed = await prisma.loan.findUniqueOrThrow({ where: { id: loan.id } });
    expect(closed.autoClosedTransactionId).toBe(row.id);

    // No FK on the marker column, on purpose — so this leaves it dangling.
    await bankService.removeTransaction(userId, row.id);
    const stillClosed = await prisma.loan.findUniqueOrThrow({ where: { id: loan.id } });
    expect(stillClosed.autoClosedTransactionId).toBe(row.id);

    const result = await documentsService.rollback(userId, doomed.document.id);

    expect(result.reopenedLoans).toEqual([]);
    expect(result.unresolvedClosedLoans).toEqual([
      { loanName: "הלוואה 782", loanNumber: "782" },
    ]);
    expect(result.message).toContain("782");
    // Named, not reopened: nothing here knows what balance it should come back with.
    const after = await prisma.loan.findUniqueOrThrow({ where: { id: loan.id } });
    expect(after.status).toBe("finished");
    expect(Number(after.currentBalance)).toBe(0);
  });
});

describe("ביטול ייבוא של דוח אשראי", () => {
  it("מוחק את הייבוא ואת כל עסקאותיו, ומסמן את המסמך", async ({ skip }) => {
    if (!dbUp) skip("MariaDB אינו זמין — יש להריץ bash backend/start-db.sh");
    const userId = await createUser("credit");
    const { creditImport, document } = await importCreditReport(userId, "credit.xlsx");

    const result = await documentsService.rollback(userId, document.id);

    expect(result.removedTransactions).toBe(2);
    expect(await prisma.creditImport.findUnique({ where: { id: creditImport.id } })).toBeNull();
    expect(await prisma.creditTransaction.count({ where: { userId } })).toBe(0);
    const after = await prisma.document.findUnique({ where: { id: document.id } });
    expect(after?.status).toBe("rolled_back");
  });
});

describe("הגנות", () => {
  it("ביטול שני על אותו מסמך נכשל במפורש", async ({ skip }) => {
    if (!dbUp) skip("MariaDB אינו זמין — יש להריץ bash backend/start-db.sh");
    const userId = await createUser("twice");
    const { document } = await importCreditReport(userId, "twice.xlsx");

    await documentsService.rollback(userId, document.id);
    await expect(documentsService.rollback(userId, document.id)).rejects.toThrow("כבר בוטל");
  });

  it("לוח סילוקין וגיליון הוצאות אינם ניתנים לביטול", async ({ skip }) => {
    if (!dbUp) skip("MariaDB אינו זמין — יש להריץ bash backend/start-db.sh");
    const userId = await createUser("kinds");
    for (const kind of ["loan_schedule", "expense_sheet"]) {
      const doc = await prisma.document.create({
        data: { userId, fileName: `${kind}.xlsx`, fileHash: `h-${kind}`, kind },
      });
      await expect(documentsService.rollback(userId, doc.id)).rejects.toThrow();
    }
  });

  it("דף חשבון מלפני שהקישור לקובץ קיים אינו ניתן לביטול אוטומטי", async ({ skip }) => {
    if (!dbUp) skip("MariaDB אינו זמין — יש להריץ bash backend/start-db.sh");
    const userId = await createUser("legacy");
    const doc = await prisma.document.create({
      data: { userId, fileName: "old.xlsx", fileHash: "h-old", kind: "bank_statement" },
    });
    await expect(documentsService.rollback(userId, doc.id)).rejects.toThrow();
  });

  it("מסמך של משתמשת אחרת אינו נגיש", async ({ skip }) => {
    if (!dbUp) skip("MariaDB אינו זמין — יש להריץ bash backend/start-db.sh");
    const [mine, theirs] = [await createUser("mine"), await createUser("theirs")];
    const { document } = await importCreditReport(theirs, "theirs.xlsx");
    await expect(documentsService.rollback(mine, document.id)).rejects.toThrow("לא נמצא");
  });
});

describe("אחסון הקובץ", () => {
  it("קובץ שנשמר נקרא בחזרה בדיוק כפי שהיה", async ({ skip }) => {
    if (!dbUp) skip("MariaDB אינו זמין — יש להריץ bash backend/start-db.sh");
    const userId = await createUser("storage");
    const bytes = Buffer.from("שורה,סכום\nמשכורת,7000\n", "utf8");

    await documentsService.record(userId, {
      fileName: "דף חשבון מרץ.xlsx",
      fileHash: "abc123",
      sizeBytes: bytes.byteLength,
      kind: "bank_statement",
      buffer: bytes,
    });

    const saved = await prisma.document.findFirst({ where: { userId } });
    expect(saved?.storagePath).toBeTruthy();

    const { stream, fileName } = await documentsService.file(userId, saved!.id);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    expect(Buffer.concat(chunks).equals(bytes)).toBe(true);
    expect(fileName).toBe("דף חשבון מרץ.xlsx");

    await documentStorage.remove(saved!.storagePath!);
  });

  it("מסמך בלי קובץ שמור מחזיר שגיאה ברורה, לא קריסה", async ({ skip }) => {
    if (!dbUp) skip("MariaDB אינו זמין — יש להריץ bash backend/start-db.sh");
    const userId = await createUser("nofile");
    const doc = await prisma.document.create({
      data: { userId, fileName: "old.xlsx", fileHash: "h-nofile", kind: "bank_statement" },
    });
    await expect(documentsService.file(userId, doc.id)).rejects.toThrow("לא נשמר");
  });

  /** remove() now deletes the file too — it must still drop the row, not throw. */
  it("מחיקת הרישום מסירה גם את הקובץ מהדיסק", async ({ skip }) => {
    if (!dbUp) skip("MariaDB אינו זמין — יש להריץ bash backend/start-db.sh");
    const userId = await createUser("remove");
    await documentsService.record(userId, {
      fileName: "temp.xlsx",
      fileHash: "h-remove",
      sizeBytes: 4,
      kind: "bank_statement",
      buffer: Buffer.from("data"),
    });
    const saved = await prisma.document.findFirst({ where: { userId } });
    expect(saved?.storagePath).toBeTruthy();
    const onDisk = documentStorage.resolve(saved!.storagePath!);

    await documentsService.remove(userId, saved!.id);

    expect(await prisma.document.count({ where: { userId } })).toBe(0);
    expect(await documentStorage.openRead(saved!.storagePath!)).toBeNull();
    expect(onDisk).not.toBeNull();
  });

  it("נתיב שמנסה לצאת מתיקיית האחסון נדחה", async ({ skip }) => {
    if (!dbUp) skip("MariaDB אינו זמין — יש להריץ bash backend/start-db.sh");
    expect(documentStorage.resolve("../../../etc/passwd")).toBeNull();
  });
});

/** Runs a real statement through the real importer, not hand-seeded rows. */
describe.skipIf(!hasFixture("bankStatementJuly"))("מקצה לקצה מול דף חשבון אמיתי", () => {
  it("ייבוא אמיתי מסמן כל שורה בקובץ שלה, וביטול מחזיר את החשבון לריק", async ({ skip }) => {
    if (!dbUp) skip("MariaDB אינו זמין — יש להריץ bash backend/start-db.sh");
    const userId = await createUser("e2e");
    const account = await prisma.bankAccount.create({
      data: { userId, bankName: "בנק בדיקה", accountName: "עו״ש" },
    });
    const buffer = readFixture("bankStatementJuly");

    const imported = await bankService.importStatement(userId, account.id, buffer, "real.xlsx");
    expect(imported.imported).toBeGreaterThan(0);

    const stamped = await prisma.bankTransaction.count({
      where: { userId, statementImportId: imported.statementImportId },
    });
    expect(stamped).toBe(imported.imported);

    await documentsService.record(userId, {
      fileName: "real.xlsx",
      fileHash: "e2e-hash",
      sizeBytes: buffer.byteLength,
      kind: "bank_statement",
      buffer,
      linkedAccountId: account.id,
      linkedStatementImportId: imported.statementImportId,
      rowsImported: imported.imported,
    });
    const document = await prisma.document.findFirst({ where: { userId, fileHash: "e2e-hash" } });
    expect(document?.storagePath).toBeTruthy();

    const result = await documentsService.rollback(userId, document!.id);

    const detached = result.keptManual + result.keptLinked;
    expect(result.removedTransactions).toBe(imported.imported - detached);
    expect(await prisma.bankTransaction.count({ where: { userId } })).toBe(detached);
    // Every income/expense the import produced is gone with it — nothing left to
    // keep counting money whose source row no longer exists.
    expect(await prisma.income.count({ where: { userId } })).toBe(0);
    expect(await prisma.expense.count({ where: { userId } })).toBe(0);

    await documentStorage.remove(document!.storagePath!);
  });

  /**
   * Full round trip: import closes the loan, undo owes it again — figures come
   * from the fixture, not a constant.
   */
  it("הלוואה שנסגרה אוטומטית מהדף האמיתי חוזרת להיות פעילה אחרי ביטול", async ({ skip }) => {
    if (!dbUp) skip("MariaDB אינו זמין — יש להריץ bash backend/start-db.sh");
    const userId = await createUser("e2e_loan");
    const account = await prisma.bankAccount.create({
      data: { userId, bankName: "בנק בדיקה", accountName: "עו״ש" },
    });
    const buffer = readFixture("bankStatementJuly");
    const imported = await bankService.importStatement(userId, account.id, buffer, "real.xlsx");

    // The payoff in the file: the largest principal row that names its loan.
    const payoff = await prisma.bankTransaction.findFirst({
      where: {
        userId,
        type: "withdrawal",
        lineKind: { in: ["loan_principal", "loan_mixed"] },
        loanRef: { not: null },
      },
      orderBy: { amount: "desc" },
    });
    expect(payoff).not.toBeNull();
    const balance = Number(payoff!.amount);

    const loan = await prisma.loan.create({
      data: {
        userId,
        loanName: "הלוואה מהדף",
        loanType: "bank",
        loanNumber: payoff!.loanRef,
        originalAmount: balance,
        currentBalance: balance,
        annualInterestRate: 4,
        monthlyPayment: 1000,
        startDate: new Date(Date.UTC(2025, 0, 1)),
        totalPayments: 60,
        paymentsMade: 12,
      },
    });

    // The loans screen is what closes it — syncFromStatement runs on every load.
    const listed = await loansService.list(userId);
    expect(listed.loans.find((l) => l.id === loan.id)?.status).toBe("finished");
    // And it recorded the row from the real file that did it.
    const closed = await prisma.loan.findUniqueOrThrow({ where: { id: loan.id } });
    expect(closed.autoClosedTransactionId).toBe(payoff!.id);

    await documentsService.record(userId, {
      fileName: "real.xlsx",
      fileHash: "e2e-loan-hash",
      sizeBytes: buffer.byteLength,
      kind: "bank_statement",
      linkedAccountId: account.id,
      linkedStatementImportId: imported.statementImportId,
      rowsImported: imported.imported,
    });
    const document = await prisma.document.findFirst({
      where: { userId, fileHash: "e2e-loan-hash" },
    });

    const result = await documentsService.rollback(userId, document!.id);
    expect(result.reopenedLoans).toHaveLength(1);
    expect(result.reopenedLoans[0]?.balance).toBe(balance);

    const after = await loansService.list(userId);
    const back = after.loans.find((l) => l.id === loan.id);
    expect(back?.status).toBe("active");
    expect(back?.currentBalance).toBe(balance);
    expect(back?.autoClosedTransactionId).toBeNull();
  });
});
