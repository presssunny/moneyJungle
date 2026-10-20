import { describe, expect, it } from "vitest";
import { libraryOptions } from "./scraperLaunch";

const launch = { companyId: "beinleumi" as const, startDate: "2026-07-01T00:00:00.000Z", defaultTimeout: 60_000, showBrowser: false, loginWaitMs: 300_000, profileDir: "/state/run-x/profile" };

describe("libraryOptions", () => {
  it("hands the library only a per-run profile — no sandbox opt-out and no failure screenshot", () => {
    const options = libraryOptions(launch);
    expect(options.args).toEqual(["--user-data-dir=/state/run-x/profile"]);
    expect(options.args.some((arg) => arg.includes("no-sandbox"))).toBe(false);
    expect(options).not.toHaveProperty("storeFailureScreenShotPath");
    expect(options).toMatchObject({ showBrowser: false, combineInstallments: false, verbose: false });
    expect(options.startDate.toISOString()).toBe(launch.startDate);
  });

  it("keeps a visible window opt-in", () => {
    expect(libraryOptions({ ...launch, showBrowser: true }).showBrowser).toBe(true);
  });
});
