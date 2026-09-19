import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, describe, it, expect } from "vitest";
import { prisma } from "../../config/database";
import { getProfile } from "./coverage.service";

const migrationSql = path.join(__dirname, "../../../prisma/migrations/20260919100000_legacy_onboarding_backfill/migration.sql");

async function runBackfillMigration() {
  const sql = await readFile(migrationSql, "utf8");
  const withoutComments = sql.split("\n").filter(line => !line.trim().startsWith("--")).join("\n");
  const statements = withoutComments.split(";").map(s => s.trim()).filter(Boolean);
  for (const statement of statements) await prisma.$executeRawUnsafe(statement);
}

async function makeUser() {
  return (await prisma.user.create({ data: { name: "__legacy_onboarding_test", email: `${crypto.randomUUID()}@example.test` } })).id;
}

const userIds: number[] = [];
afterAll(async () => { if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } }); await prisma.$disconnect(); });

describe("legacy onboarding classification (P0.1 / G8)", () => {
  it("a brand-new user with no financial activity starts pending", async () => {
    const userId = await makeUser(); userIds.push(userId);
    const profile = await getProfile(userId);
    expect(profile.onboarding).toBe("pending");
  });

  it("a user with prior financial activity but no profile row yet starts legacy, not pending", async () => {
    const userId = await makeUser(); userIds.push(userId);
    await prisma.expense.create({ data: { userId, amount: 42, expenseDate: new Date("2026-01-01") } });
    const profile = await getProfile(userId);
    expect(profile.onboarding).toBe("legacy");
  });

  it("a completed user is never reclassified, even though they have activity", async () => {
    const userId = await makeUser(); userIds.push(userId);
    await prisma.expense.create({ data: { userId, amount: 42, expenseDate: new Date("2026-01-01") } });
    await prisma.financialProfile.create({ data: { userId, onboarding: "completed", completedAt: new Date(), reviewedAt: new Date() } });
    const profile = await getProfile(userId);
    expect(profile.onboarding).toBe("completed");
  });

  it("prior financial activity alone recognizes bank/credit rows, not only expenses", async () => {
    const userId = await makeUser(); userIds.push(userId);
    await prisma.income.create({ data: { userId, type: "salary", amount: 100, incomeDate: new Date("2026-01-01") } });
    const profile = await getProfile(userId);
    expect(profile.onboarding).toBe("legacy");
  });

  it("backfill migration promotes a pre-existing pending+unreviewed profile with activity to legacy, and is idempotent", async () => {
    const userId = await makeUser(); userIds.push(userId);
    await prisma.expense.create({ data: { userId, amount: 15, expenseDate: new Date("2026-01-01") } });
    await prisma.financialProfile.create({ data: { userId, onboarding: "pending" } });

    await runBackfillMigration();
    const afterFirst = await prisma.financialProfile.findUniqueOrThrow({ where: { userId } });
    expect(afterFirst.onboarding).toBe("legacy");

    await runBackfillMigration();
    const afterSecond = await prisma.financialProfile.findUniqueOrThrow({ where: { userId } });
    expect(afterSecond.onboarding).toBe("legacy");
    expect(await prisma.financialProfile.count({ where: { userId } })).toBe(1);
  });

  it("backfill migration never touches a reviewed or already-completed profile", async () => {
    const userId = await makeUser(); userIds.push(userId);
    await prisma.expense.create({ data: { userId, amount: 15, expenseDate: new Date("2026-01-01") } });
    await prisma.financialProfile.create({ data: { userId, onboarding: "completed", completedAt: new Date(), reviewedAt: new Date() } });

    await runBackfillMigration();
    const profile = await prisma.financialProfile.findUniqueOrThrow({ where: { userId } });
    expect(profile.onboarding).toBe("completed");
  });

  it("backfill migration creates a legacy profile row for an activity-bearing user with no row at all, and is idempotent", async () => {
    const userId = await makeUser(); userIds.push(userId);
    await prisma.expense.create({ data: { userId, amount: 15, expenseDate: new Date("2026-01-01") } });

    await runBackfillMigration();
    expect((await prisma.financialProfile.findUniqueOrThrow({ where: { userId } })).onboarding).toBe("legacy");

    await runBackfillMigration();
    expect(await prisma.financialProfile.count({ where: { userId } })).toBe(1);
  });

  it("backfill migration does not create a profile row for a new user with no activity", async () => {
    const userId = await makeUser(); userIds.push(userId);
    await runBackfillMigration();
    expect(await prisma.financialProfile.findUnique({ where: { userId } })).toBeNull();
  });
});
