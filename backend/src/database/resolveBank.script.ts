/**
 * Re-resolve every imported bank row, for use after new categorization rules, a
 * new classification pattern, or a late-arriving credit statement. Idempotent —
 * a second run reports 0 updated rows.
 *
 *   npx ts-node -T src/database/resolveBank.script.ts
 */
import { prisma } from "../config/database";
import { describeResolveResult, reconciliationService } from "../modules/bank/reconciliation.service";

async function main() {
  const users = await prisma.user.findMany({ select: { id: true, name: true } });
  for (const user of users) {
    const result = await reconciliationService.resolveAll(user.id);
    console.log(`[סיווג תנועות בנק] ${user.name}: ${describeResolveResult(result)}`);
    if (result.unresolved.count > 0) {
      const rows = await prisma.bankTransaction.findMany({
        where: { userId: user.id, resolution: null },
        select: { id: true, transactionDate: true, description: true, amount: true, lineKind: true },
      });
      for (const row of rows) {
        console.warn(
          `[סיווג תנועות בנק] ⚠ ללא סיווג: #${row.id} ${row.transactionDate.toISOString().slice(0, 10)} ` +
            `${row.description ?? ""} ${row.amount} (${row.lineKind})`
        );
      }
    }
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
