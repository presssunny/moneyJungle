import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// The bank library runs inside her signed-in session (CLAUDE.md §7); the version
// that was read and reviewed is the one that runs — no range, no silent upgrade.
const REVIEWED = "6.12.2";
const ROOT = path.resolve(__dirname, "../../..");

describe("israeli-bank-scrapers is pinned", () => {
  it("package.json names the exact reviewed version", () => {
    const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as { dependencies: Record<string, string> };
    expect(pkg.dependencies["israeli-bank-scrapers"]).toBe(REVIEWED);
  });

  it("the lockfile and the installed copy are that version", () => {
    const lock = JSON.parse(readFileSync(path.join(ROOT, "package-lock.json"), "utf8")) as { packages: Record<string, { version?: string }> };
    expect(lock.packages[""]).toMatchObject({ dependencies: expect.objectContaining({ "israeli-bank-scrapers": REVIEWED }) });
    expect(lock.packages["node_modules/israeli-bank-scrapers"]?.version).toBe(REVIEWED);
    const installed = JSON.parse(readFileSync(path.join(ROOT, "node_modules/israeli-bank-scrapers/package.json"), "utf8")) as { version: string };
    expect(installed.version).toBe(REVIEWED);
  });
});
