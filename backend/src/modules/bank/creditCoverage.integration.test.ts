import crypto from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../config/database";
import { cardCompanyOf } from "./bankParser.service";
import { buildCreditCoverage } from "./creditCoverage.service";

let userId: number;

beforeEach(async () => {
  userId = (await prisma.user.create({ data: { name: "__credit_coverage_test", email: `${crypto.randomUUID()}@example.test` } })).id;
});
afterEach(async () => { await prisma.user.delete({ where: { id: userId } }); });
afterAll(async () => { await prisma.$disconnect(); });

/** A confirmed card file with one row charged on `chargeDay`, on a card whose company is `issuer`. */
async function cardCharged(issuer: string, chargeDay: string) {
  const card = await prisma.creditCard.create({ data: { userId, name: "הכרטיס", issuer, lastFour: "4321" } });
  const file = await prisma.creditImport.create({ data: { userId, fileName: "card.xlsx", importMonth: 10, importYear: 2026, status: "confirmed" } });
  await prisma.creditTransaction.create({ data: { userId, creditImportId: file.id, cardId: card.id, transactionDate: new Date("2026-09-20"), billingDate: new Date("2026-09-20"),
    chargeDate: new Date(chargeDay), businessName: "קנייה", amount: 300 } });
}

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe("a bank card debit that names no card", () => {
  it("is covered only by a confirmed file of the same card company", async () => {
    await cardCharged("כאל", "2026-10-10");
    const coverage = await buildCreditCoverage(userId);
    expect(coverage.verdictFor({ transactionDate: day("2026-10-11"), description: 'עפ"י הרשאה כאל' }).covered).toBe(true);
    expect(coverage.verdictFor({ transactionDate: day("2026-10-11"), description: 'עפ"י הרשאה מקס' }).covered).toBe(false);
    expect(coverage.verdictFor({ transactionDate: day("2026-10-11"), description: "ויזה" }).covered).toBe(false);
  });

  it("is not covered when the card's company is not a known name", async () => {
    await cardCharged("הכרטיס של אמא", "2026-10-10");
    expect((await buildCreditCoverage(userId)).verdictFor({ transactionDate: day("2026-10-11"), description: 'עפ"י הרשאה כאל' }).covered).toBe(false);
  });
});

describe("cardCompanyOf", () => {
  it("knows each company by its names, and only as a whole word", () => {
    expect(cardCompanyOf('עפ"י הרשאה ויזה כאל')).toBe("cal");
    expect(cardCompanyOf("LEUMI CARD")).toBe("max");
    expect(cardCompanyOf("ישראכרט")).toBe("isracard");
    expect(cardCompanyOf("אמריקן אקספרס")).toBe("amex");
    expect(cardCompanyOf("Diners")).toBe("diners");
    expect(cardCompanyOf("מיכאל")).toBeNull();
    expect(cardCompanyOf("מקסימום")).toBeNull();
    expect(cardCompanyOf("calendar")).toBeNull();
    expect(cardCompanyOf("ויזה")).toBeNull();
    expect(cardCompanyOf("כרטיסי אשראי")).toBeNull();
  });
});
