import crypto from "crypto";
import { describe, expect, it } from "vitest";
import { hashPassword, needsPasswordRehash, verifyPassword } from "./password.utils";

describe("versioned password hashing", () => {
  it("verifies the current work factor and rejects incorrect passwords", async () => {
    const hash = await hashPassword("correct-password");
    expect(hash.startsWith("scrypt$131072$8$1$")).toBe(true);
    expect(needsPasswordRehash(hash)).toBe(false);
    expect(await verifyPassword("correct-password", hash)).toBe(true);
    expect(await verifyPassword("wrong-password", hash)).toBe(false);
  });
  it("continues verifying legacy hashes so existing accounts can upgrade on login", async () => {
    const salt = crypto.randomBytes(16);
    const key = await new Promise<Buffer>((resolve, reject) => crypto.scrypt("legacy", salt, 64, (error, value) => error ? reject(error) : resolve(value)));
    const hash = `${salt.toString("hex")}:${key.toString("hex")}`;
    expect(await verifyPassword("legacy", hash)).toBe(true);
    expect(needsPasswordRehash(hash)).toBe(true);
  });
  it("rejects malformed or attacker-selected work factors before running scrypt", async () => {
    for (const hash of [null, "", "ab:cd", "scrypt$999999999$8$1$aa$bb", "00".repeat(16) + ":" + "00".repeat(64) + ":extra"]) {
      expect(await verifyPassword("password", hash)).toBe(false);
    }
  });
});
