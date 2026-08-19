import { prisma } from "../../config/database";
import { Prisma } from "../../../generated/prisma/client";
import { ApiError } from "../../utils/ApiError";
import { round2 } from "../../utils/money.utils";
import { buildRuleCategorizer } from "../categories/categorization.service";
import { hashFile } from "../imports/statementDetector.service";
import { accountBalanceService } from "./accountBalance.service";
import {
  classifyBankLine,
  describeIngestionReport,
  describeMonthlyConditions,
  parseBankStatement,
  parseBankStatementPdf,
} from "./bankParser.service";
import {
  CreateBankAccountBody,
  CreateBankTransactionBody,
  UpdateBankAccountBody,
} from "./bank.validation";
import { describeResolveResult, reconciliationService } from "./reconciliation.service";

async function requireAccount(userId: number, id: number) {
  const account = await prisma.bankAccount.findFirst({ where: { id, userId } });
  if (!account) throw ApiError.notFound("חשבון הבנק לא נמצא");
  return account;
}

export const bankService = {
  /**
   * Accounts with their balance recomputed from statements + transactions, plus
   * where that number came from. The stored column is refreshed on read so a
   * balance can never be stale relative to the data it is derived from.
   */
  async listAccounts(userId: number) {
    const accounts = await prisma.bankAccount.findMany({
      where: { userId },
      orderBy: { id: "asc" },
      include: { _count: { select: { transactions: true } } },
    });
    return Promise.all(
      accounts.map(async (account) => {
        const derived = await accountBalanceService.recompute(userId, account.id);
        return { ...account, currentBalance: derived.balance, balanceDetail: derived };
      })
    );
  },

  /** Every statement taken in for an account, newest period first. */
  listStatements(userId: number, accountId: number) {
    return prisma.bankStatementImport.findMany({
      where: { userId, bankAccountId: accountId },
      orderBy: [{ coverageTo: "desc" }, { createdAt: "desc" }],
    });
  },

  /** State the balance the bank shows, for files that print no balance column. */
  async setAnchor(userId: number, accountId: number, balance: number, asOf: string) {
    await requireAccount(userId, accountId);
    await prisma.bankAccount.update({
      where: { id: accountId },
      data: { anchorBalance: balance, anchorDate: new Date(asOf) },
    });
    return accountBalanceService.recompute(userId, accountId);
  },

  createAccount(userId: number, body: CreateBankAccountBody) {
    return prisma.bankAccount.create({
      data: {
        userId,
        bankName: body.bankName,
        accountName: body.accountName,
        initialBalance: body.initialBalance,
        currentBalance: body.initialBalance,
      },
    });
  },

  async updateAccount(userId: number, id: number, body: UpdateBankAccountBody) {
    await requireAccount(userId, id);
    // No manual balance shifting: the balance is recomputed from the statements
    // and the transactions, so editing the opening balance only matters when no
    // statement has ever anchored the account.
    const data: Prisma.BankAccountUncheckedUpdateInput = { ...body };
    await prisma.bankAccount.update({ where: { id }, data });
    await accountBalanceService.recompute(userId, id);
    return prisma.bankAccount.findFirst({ where: { id, userId } });
  },

  async removeAccount(userId: number, id: number) {
    await requireAccount(userId, id);
    await prisma.bankAccount.delete({ where: { id } });
  },

  async listTransactions(userId: number, accountId: number) {
    await requireAccount(userId, accountId);
    return prisma.bankTransaction.findMany({
      where: { userId, bankAccountId: accountId },
      orderBy: [{ transactionDate: "desc" }, { id: "desc" }],
      include: { category: true },
    });
  },

  async createTransaction(userId: number, accountId: number, body: CreateBankTransactionBody) {
    await requireAccount(userId, accountId);
    const transaction = await prisma.bankTransaction.create({
      data: {
        userId,
        bankAccountId: accountId,
        transactionDate: body.transactionDate,
        description: body.description ?? null,
        amount: body.amount,
        type: body.type,
        categoryId: body.categoryId ?? null,
      },
      include: { category: true },
    });
    // A row dated inside a period the bank already reported is deliberately not
    // added on top: the printed balance for that period already accounts for it.
    await accountBalanceService.recompute(userId, accountId);
    return transaction;
  },

  /**
   * Import a עו״ש statement: money-in becomes deposits, money-out withdrawals
   * (auto-categorized). Rows already present — same date, amount, type and
   * description — are skipped, so re-uploading is safe.
   */
  async importStatement(userId: number, accountId: number, buffer: Buffer, fileName = "") {
    await requireAccount(userId, accountId);
    const isPdf = /\.pdf$/i.test(fileName) || buffer.subarray(0, 5).toString("latin1") === "%PDF-";
    const statement = isPdf ? await parseBankStatementPdf(buffer) : parseBankStatement(buffer);
    const { rows, report } = statement;
    // Ingestion log (Hebrew): which parser ran, what it found and what it could
    // not read. Rows we are unsure about are listed — never silently dropped.
    console.log(`[קליטת דוח בנק] ${describeIngestionReport(report)}`);
    for (const issue of report.rejected) {
      console.warn(`[קליטת דוח בנק] נדחתה שורה (עמ' ${issue.page ?? "-"}): ${issue.line} — ${issue.reason}`);
    }
    for (const issue of report.review) {
      console.warn(`[קליטת דוח בנק] לבדיקה ידנית (עמ' ${issue.page ?? "-"}): ${issue.line} — ${issue.reason}`);
    }
    for (const mismatch of report.balanceMismatches) {
      console.warn(
        `[קליטת דוח בנק] אי-התאמת יתרה בשורה ${mismatch.index + 1} (${mismatch.date} ${mismatch.description}): ` +
          `צפוי ${mismatch.expected}, מודפס ${mismatch.printed}, פער ${mismatch.diff}`
      );
    }
    for (const pair of report.roundTrips) {
      console.warn(
        `[קליטת דוח בנק] סבב כספים אפשרי: ${pair.amount} יצא ב-${pair.withdrawalDate} (${pair.withdrawalDescription}) ` +
          `וחזר ב-${pair.depositDate} (${pair.depositDescription}), הפרש ${pair.daysApart} ימים — מוחרג מההכנסה עד אישור ידני`
      );
    }
    for (const candidate of report.salaryCandidates) {
      console.log(`[קליטת דוח בנק] תקבול לאישור: ${candidate.line} — ${candidate.reason}`);
    }
    for (const line of describeMonthlyConditions(report)) {
      console.log(`[קליטת דוח בנק] תנאי הפקדת שכר ${line}`);
    }
    const categorize = await buildRuleCategorizer(userId);

    // Build a dedup key set from existing transactions in the file's date range.
    const dates = rows.map((r) => r.date.getTime());
    const existing = await prisma.bankTransaction.findMany({
      where: {
        userId,
        bankAccountId: accountId,
        transactionDate: { gte: new Date(Math.min(...dates)), lte: new Date(Math.max(...dates)) },
      },
      select: { transactionDate: true, amount: true, type: true, description: true },
    });
    const keyOf = (d: Date, amount: number, type: string, desc: string | null) =>
      `${d.toISOString().slice(0, 10)}|${round2(amount)}|${type}|${(desc ?? "").trim()}`;
    const seen = new Set(existing.map((t) => keyOf(t.transactionDate, Number(t.amount), t.type, t.description)));

    const fresh = rows.filter((r) => {
      const key = keyOf(r.date, r.amount, r.type, r.description);
      if (seen.has(key)) return false;
      seen.add(key); // also dedupes repeats within the same file
      return true;
    });

    // Recorded BEFORE the rows so each row can name its source file — needed to
    // undo an import without guessing a date range across overlapping statements.
    // Recorded even for an all-duplicate upload: it still moves the balance anchor.
    const coverageFrom = new Date(Math.min(...dates));
    const coverageTo = new Date(Math.max(...dates));
    const statementImport = await prisma.bankStatementImport.create({
      data: {
        userId,
        bankAccountId: accountId,
        fileName,
        fileHash: hashFile(buffer),
        coverageFrom,
        coverageTo,
        openingBalance: report.openingBalance,
        closingBalance: report.closingBalance,
        parsedRows: rows.length,
        importedRows: fresh.length,
        skippedDuplicates: rows.length - fresh.length,
      },
    });

    let deposits = 0;
    let withdrawals = 0;
    if (fresh.length > 0) {
      await prisma.$transaction([
        prisma.bankTransaction.createMany({
          data: fresh.map((r) => {
            if (r.type === "deposit") deposits += 1;
            else withdrawals += 1;
            // Persist the classification so the resolver knows *what kind* of
            // money each row is — not just its direction. What each kind MEANS
            // (and whether a card settlement is excluded) is decided by the
            // resolver below, which can revisit it when a credit statement lands.
            const { lineKind, loanRef } = classifyBankLine(r.description, r.type);
            return {
              userId,
              bankAccountId: accountId,
              transactionDate: r.date,
              description: r.description,
              amount: r.amount,
              type: r.type,
              categoryId: r.type === "withdrawal" ? categorize(r.description) : null,
              lineKind,
              loanRef,
              reconcileStatus: "pending",
              statementImportId: statementImport.id,
            };
          }),
        }),
      ]);
    }

    // Full recomputation — there is no increment path left that could drift.
    const balance = await accountBalanceService.recompute(userId, accountId);
    console.log(
      `[קליטת דוח בנק] יתרת החשבון: ${balance.balance} — ${balance.explanation}` +
        (report.closingBalance === null
          ? " (הקובץ הזה אינו כולל עמודת יתרה, ולכן אינו יכול לעגן את היתרה)"
          : "")
    );

    // Resolve straight away: a row that sits in `pending` is invisible to every
    // figure in the app, which reads as "the import did nothing". The resolver
    // gives every row a meaning — and states in Hebrew what it decided and why.
    const autoReconciled = fresh.length > 0 ? await reconciliationService.resolveAll(userId) : null;
    if (autoReconciled) {
      console.log(`[קליטת דוח בנק] סיווג התנועות: ${describeResolveResult(autoReconciled)}`);
    }

    return {
      parsed: rows.length,
      imported: fresh.length,
      skippedDuplicates: rows.length - fresh.length,
      deposits,
      withdrawals,
      report,
      autoReconciled,
      /** What a rollback of this import needs to find its rows again. */
      statementImportId: statementImport.id,
    };
  },

  async removeTransaction(userId: number, id: number) {
    const transaction = await prisma.bankTransaction.findFirst({ where: { id, userId } });
    if (!transaction) throw ApiError.notFound("התנועה לא נמצאה");
    await prisma.bankTransaction.delete({ where: { id } });
    await accountBalanceService.recompute(userId, transaction.bankAccountId);
  },
};
