import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../config/database";
import { ApiError } from "../../utils/ApiError";
import { assetsService } from "./assets.service";

let userId: number;
let otherId: number;

beforeAll(async () => {
  userId = (await prisma.user.create({ data: { name: "__assets", email: `${crypto.randomUUID()}@example.test` } })).id;
  otherId = (await prisma.user.create({ data: { name: "__assets_other", email: `${crypto.randomUUID()}@example.test` } })).id;
});
afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [userId, otherId] } } });
  await prisma.$disconnect();
});

describe("assets CRUD", () => {
  it("creates, lists, updates and deletes an asset scoped to its owner", async () => {
    const created = await assetsService.create(userId, { name: "קרן השתלמות", assetType: "pension", currentValue: 42000, asOfDate: new Date("2026-09-01") });
    expect(created.userId).toBe(userId);

    expect(await assetsService.list(otherId)).toEqual([]);
    expect((await assetsService.list(userId)).map((a) => a.id)).toEqual([created.id]);

    const updated = await assetsService.update(userId, created.id, { currentValue: 45000 });
    expect(Number(updated.currentValue)).toBe(45000);

    await expect(assetsService.update(otherId, created.id, { currentValue: 1 })).rejects.toThrow(ApiError);
    await expect(assetsService.remove(otherId, created.id)).rejects.toThrow(ApiError);

    await assetsService.remove(userId, created.id);
    expect(await assetsService.list(userId)).toEqual([]);
  });
});
