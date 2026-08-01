/**
 * Records the parser output the golden suites compare against.
 *
 *   npm run test:golden:record
 *
 * ⚠️ Only when a change in the numbers is intended AND checked against the bank's
 * printed figures. Running it to make a red test green destroys the file's whole
 * value — it will pass by construction.
 */
import { parseBankStatement, parseBankStatementPdf } from "../modules/bank/bankParser.service";
import { parseLoanSchedule } from "../modules/loans/loanSchedule.parser";
import { FixtureName, hasFixture, readFixture } from "./fixtures";
import { GOLDEN_FILE, writeGolden } from "./golden";
import { bankGolden, scheduleGolden } from "./goldenShape";

const bankExcel: Array<{ key: string; fixture: FixtureName }> = [
  { key: "bank/excel/july", fixture: "bankStatementJuly" },
  { key: "bank/excel/h1", fixture: "bankStatementH1" },
];

const schedules: Array<{ key: string; fixture: FixtureName }> = [
  { key: "schedule/432", fixture: "loanSchedule432" },
  { key: "schedule/562", fixture: "loanSchedule562" },
];

async function main() {
  let recorded = 0;
  let skipped = 0;

  const note = (ok: boolean, key: string, detail: string) => {
    console.log(`${ok ? "✓" : "⊘"} ${key.padEnd(20)} ${detail}`);
    ok ? (recorded += 1) : (skipped += 1);
  };

  for (const { key, fixture } of bankExcel) {
    if (!hasFixture(fixture)) {
      note(false, key, "קובץ חסר — מדולג");
      continue;
    }
    const parsed = parseBankStatement(readFixture(fixture));
    writeGolden(key, bankGolden(parsed));
    note(true, key, `${parsed.rows.length} שורות · יתרת סגירה ${parsed.report.closingBalance}`);
  }

  if (hasFixture("bankStatementPdf")) {
    const parsed = await parseBankStatementPdf(readFixture("bankStatementPdf"));
    writeGolden("bank/pdf", bankGolden(parsed));
    note(true, "bank/pdf", `${parsed.rows.length} שורות · פרסר ${parsed.report.parser}`);
  } else {
    note(false, "bank/pdf", "קובץ חסר — מדולג");
  }

  for (const { key, fixture } of schedules) {
    if (!hasFixture(fixture)) {
      note(false, key, "קובץ חסר — מדולג");
      continue;
    }
    const parsed = parseLoanSchedule(readFixture(fixture));
    writeGolden(key, scheduleGolden(parsed));
    note(true, key, `הלוואה ${parsed.loanNumber}/${parsed.trackNumber} · יתרה ${parsed.currentBalance}`);
  }

  console.log(`\nנרשמו ${recorded}, דולגו ${skipped}`);
  console.log(`הקובץ: ${GOLDEN_FILE}`);
}

main().catch((err: unknown) => {
  console.error("רישום ה־golden נכשל:", err);
  process.exitCode = 1;
});
