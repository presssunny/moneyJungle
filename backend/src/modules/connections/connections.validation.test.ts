import { describe, expect, it } from "vitest";
import { createConnectionSchema, updateConnectionSchema } from "./connections.validation";

describe("connection bodies", () => {
  it("refuse credentials outright — she signs in on the provider's own page, never ours", () => {
    expect(createConnectionSchema.safeParse({ provider: "beinleumi", bankAccountId: 1, credentials: { username: "u", password: "p" } }).success).toBe(false);
    expect(updateConnectionSchema.safeParse({ credentials: { password: "p" } }).success).toBe(false);
    expect(createConnectionSchema.safeParse({ provider: "beinleumi", bankAccountId: 1, loginMethod: "password" }).success).toBe(false);
  });

  it("accept an official-window connection", () => {
    expect(createConnectionSchema.safeParse({ provider: "beinleumi", bankAccountId: 1 }).success).toBe(true);
    expect(updateConnectionSchema.safeParse({ loginMethod: "official_window" }).success).toBe(true);
  });
});
