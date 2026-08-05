/**
 * The real bank files the parsers are verified against — account numbers,
 * balances, employer names, so they are git-ignored and a fresh clone has none.
 * Suites skip rather than fail, which means a green run without them proves
 * nothing; `npm run test:fixtures` reports what is present.
 */
import fs from "fs";
import path from "path";

export const FIXTURES_DIR = path.resolve(__dirname, "../../tests/fixtures");

/** The files the golden suites look for. Names are ours, not the bank's. */
export const FIXTURES = {
  bankStatementJuly: "bank-statement.xlsx",
  bankStatementH1: "bank-statement-h1.xlsx",
  bankStatementPdf: "bank-statement.pdf",
  loanSchedule432: "loan-schedule-1.xlsx",
  loanSchedule562: "loan-schedule-2.xlsx",
  creditStatement: "credit-statement.xlsx",
} as const;

export type FixtureName = keyof typeof FIXTURES;

export function fixturePath(name: FixtureName): string {
  return path.join(FIXTURES_DIR, FIXTURES[name]);
}

export function hasFixture(name: FixtureName): boolean {
  return fs.existsSync(fixturePath(name));
}

export function readFixture(name: FixtureName): Buffer {
  const file = fixturePath(name);
  if (!fs.existsSync(file)) {
    throw new Error(
      `חסר קובץ בדיקה: ${FIXTURES[name]}\n` +
        `יש להעתיק את דף החשבון האמיתי אל ${FIXTURES_DIR}\n` +
        `(ראה tests/fixtures/README.md)`
    );
  }
  return fs.readFileSync(file);
}
