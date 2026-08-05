/**
 * Recorded parser output as a numeric regression net. Real balances, so the store
 * sits beside the fixtures and is git-ignored. The weaker of the two nets —
 * re-recording makes it pass by definition; the invariants need no stored number.
 */
import fs from "fs";
import path from "path";
import { FIXTURES_DIR } from "./fixtures";

const GOLDEN_FILE = path.join(FIXTURES_DIR, "golden.json");

type GoldenStore = Record<string, unknown>;

function load(): GoldenStore {
  if (!fs.existsSync(GOLDEN_FILE)) return {};
  return JSON.parse(fs.readFileSync(GOLDEN_FILE, "utf8")) as GoldenStore;
}

export function hasGolden(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(load(), key);
}

export function readGolden(key: string): unknown {
  const store = load();
  if (!Object.prototype.hasOwnProperty.call(store, key)) {
    throw new Error(`אין golden שמור עבור "${key}" — יש להריץ: npm run test:golden:record`);
  }
  return store[key];
}

/** Used only by the recorder script. */
export function writeGolden(key: string, value: unknown): void {
  const store = load();
  store[key] = value;
  fs.mkdirSync(FIXTURES_DIR, { recursive: true });
  fs.writeFileSync(GOLDEN_FILE, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

export { GOLDEN_FILE };
