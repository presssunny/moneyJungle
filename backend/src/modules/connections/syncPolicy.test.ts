import { describe, expect, it } from "vitest";
import { RETRY_COOLDOWN_MS, retryBlock } from "./syncPolicy";

const now = new Date("2026-10-17T10:00:00.000Z");
const ago = (ms: number) => new Date(now.getTime() - ms);
const password = { loginMethod: "password", blockedReason: null };

describe("retryBlock", () => {
  it("lets a first sync, a success, a cancel or a restart through at once", () => {
    expect(retryBlock(password, null, now)).toBeNull();
    expect(retryBlock(password, { status: "succeeded", errorType: null, finishedAt: ago(1_000) }, now)).toBeNull();
    for (const errorType of ["CANCELLED", "BROWSER_CLOSED", "INTERRUPTED", "APP"]) expect(retryBlock(password, { status: "failed", errorType, finishedAt: ago(1_000) }, now)).toBeNull();
  });

  it("holds a retry after a failed login for the cooldown, then lets it go", () => {
    const failed = { status: "failed", errorType: "TIMEOUT", finishedAt: ago(30_000) };
    expect(retryBlock(password, failed, now)).toMatchObject({ reason: "cooldown", until: new Date(failed.finishedAt.getTime() + RETRY_COOLDOWN_MS) });
    expect(retryBlock(password, { ...failed, finishedAt: ago(RETRY_COOLDOWN_MS + 1) }, now)).toBeNull();
  });

  it("blocks a password login the bank refused until the credentials change, with no timer", () => {
    expect(retryBlock({ loginMethod: "password", blockedReason: "INVALID_PASSWORD" }, { status: "failed", errorType: "INVALID_PASSWORD", finishedAt: ago(RETRY_COOLDOWN_MS * 10) }, now)).toMatchObject({ reason: "credentials", until: null });
  });

  it("does not hold an official-window login on stored credentials it never uses", () => {
    expect(retryBlock({ loginMethod: "official_window", blockedReason: "INVALID_PASSWORD" }, null, now)).toBeNull();
  });
});
