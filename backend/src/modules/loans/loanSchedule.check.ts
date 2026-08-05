/**
 * Human-readable dump of what the schedule parser read — a diagnostic for
 * eyeballing a NEW export before it becomes a fixture. It asserts nothing; the
 * assertions live in `loanSchedule.golden.test.ts`.
 *
 * Run: npx ts-node -T src/modules/loans/loanSchedule.check.ts [file...]
 */
import fs from "fs";
import path from "path";
import { parseLoanSchedule, ScheduleParseError } from "./loanSchedule.parser";

const FIXTURES = path.resolve(__dirname, "../../../tests/fixtures");
const DEFAULTS = ["loan-schedule-1.xlsx", "loan-schedule-2.xlsx"].map((name) => path.join(FIXTURES, name));

const files = process.argv.slice(2).length > 0 ? process.argv.slice(2) : DEFAULTS;
let failures = 0;

for (const file of files) {
  if (!fs.existsSync(file)) {
    console.log(`⊘ ${file} — לא נמצא, מדולג`);
    continue;
  }
  try {
    const s = parseLoanSchedule(fs.readFileSync(file));
    console.log(`\n=== ${file.split("/").pop()}`);
    console.log(` הלוואה ${s.loanNumber} · מסלול ${s.trackNumber} "${s.trackName}" · חשבון ${s.accountNumber}`);
    console.log(` יתרת קרן        ${s.currentBalance.toLocaleString("he-IL")}`);
    console.log(` ריבית שנתית     ${s.annualInterestRate}%  (פיזור ${s.checks.rateSpreadPpm} ppm)`);
    console.log(` החזר חודשי      ${s.monthlyPayment.toLocaleString("he-IL")}`);
    console.log(` תשלומים         ${s.paymentsMade} שולמו · ${s.paymentsRemaining} נותרו · ${s.totalPayments} סה"כ`);
    console.log(` תשלום הבא/סיום  ${s.nextPaymentDate} → ${s.expectedEndDate}`);
    console.log(` ריבית עתידית    ${s.remainingInterest.toLocaleString("he-IL")}`);
    console.log(` סכום מקורי      ${s.originalAmount.toLocaleString("he-IL")} (${s.originalAmountSource})`);
    console.log(` נפרע            ${s.principalPaid.toLocaleString("he-IL")} קרן · ${s.interestPaid.toLocaleString("he-IL")} ריבית · ${s.progressPercent}%`);
    console.log(` ✓ Σקרן=${s.checks.principalSum.toLocaleString("he-IL")} תואם ליתרה · ${s.rows.length} שורות`);
  } catch (err) {
    failures += 1;
    const message = err instanceof ScheduleParseError ? err.message : String(err);
    console.log(`\n✗ ${file.split("/").pop()} — ${message}`);
  }
}

console.log(failures === 0 ? "\nכל הקבצים נקראו בהצלחה ✔" : `\n${failures} כשלים ✗`);
process.exit(failures === 0 ? 0 : 1);
