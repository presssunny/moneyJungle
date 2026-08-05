/**
 * Says which real-file fixtures are present (`npm run test:fixtures`). The golden
 * suites skip silently when one is missing, so a green run proves nothing about
 * the parsers unless this reports them all present.
 */
import { FIXTURES, FIXTURES_DIR, FixtureName, hasFixture } from "./fixtures";
import { GOLDEN_FILE, hasGolden } from "./golden";

const GOLDEN_KEYS: Partial<Record<FixtureName, string>> = {
  bankStatementJuly: "bank/excel/july",
  bankStatementH1: "bank/excel/h1",
  bankStatementPdf: "bank/pdf",
  loanSchedule432: "schedule/432",
  loanSchedule562: "schedule/562",
};

console.log(`תיקיית ה־fixtures: ${FIXTURES_DIR}\n`);

let missing = 0;
for (const name of Object.keys(FIXTURES) as FixtureName[]) {
  const present = hasFixture(name);
  if (!present) missing += 1;
  const key = GOLDEN_KEYS[name];
  const golden = key ? (hasGolden(key) ? "golden ✓" : "golden ✗") : "—";
  console.log(`${present ? "✓" : "✗"} ${FIXTURES[name].padEnd(26)} ${golden}`);
}

console.log(`\nקובץ ה־golden: ${GOLDEN_FILE}`);
if (missing > 0) {
  console.log(
    `\n⚠️  ${missing} קבצים חסרים. הבדיקות שתלויות בהם ידלגו — ריצה ירוקה אינה מוכיחה\n` +
      `   שהפרסרים עובדים. ראה tests/fixtures/README.md.`
  );
} else {
  console.log("\nכל קבצי הבדיקה קיימים.");
}
