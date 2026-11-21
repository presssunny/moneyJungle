// Loaded inside the sync worker (see scraperWorker.ts): no src/config or Prisma.
// CLAUDE.md §7 A2: on a department page this run landed on, one fixed read of the text shown in its
// table cells. No click, scroll, input value, network body, cookie or token; the cells never leave the worker.
import type { Page } from "puppeteer";
import { sleep } from "israeli-bank-scrapers/lib/helpers/waiting";
import { parseLoanTables, parseStandingOrderTables, type CellTables, type TableParse } from "./departmentTables.parser";
import { LOAN_DETAILS_NOT_APPROVED } from "./siteDepartments";

export const MAX_TABLES = 20;
export const MAX_ROWS = 200;
export const MAX_CELLS = 12;
export const MAX_CELL_TEXT = 80;
const FRAME_READ_MS = 5_000;

/**
 * Run in each same-origin frame as a fixed string, like MENU_LINKS: own rows and cells of each table,
 * innerText only (what is shown). A cell holding a form control or editable text is read as "", so
 * nothing she typed or picked is ever returned; so is a cell not rendered, whose innerText would be its hidden text.
 */
export const TABLE_CELLS = `Array.from(document.querySelectorAll("table")).slice(0, ${MAX_TABLES}).map((t) => Array.from(t.rows).slice(0, ${MAX_ROWS}).map((r) => Array.from(r.cells).slice(0, ${MAX_CELLS}).map((c) => !c.getClientRects().length || c.querySelector("input, select, textarea, button, [contenteditable]") ? "" : (c.innerText || "").replace(/\\s+/g, " ").trim().slice(0, ${MAX_CELL_TEXT}))))`;

/** The page's answer is untrusted: anything off-shape is dropped, and the caps hold again here. */
export function cellTables(found: unknown): string[][][] {
  if (!Array.isArray(found)) return [];
  return found.slice(0, MAX_TABLES).filter(Array.isArray).map((rows: unknown[]) => rows.slice(0, MAX_ROWS).filter(Array.isArray)
    .map((cells: unknown[]) => cells.slice(0, MAX_CELLS).map((cell) => (typeof cell === "string" ? cell.slice(0, MAX_CELL_TEXT) : ""))));
}

/** Every frame of the landed page on its own origin; another site's frame is never read. */
export async function readTables(page: Page): Promise<string[][][]> {
  const origin = new URL(page.url()).origin;
  const tables: string[][][] = [];
  for (const frame of page.frames()) {
    if (!frame.url().startsWith(`${origin}/`) || tables.length >= MAX_TABLES) continue;
    const found: unknown = await Promise.race([frame.evaluate(TABLE_CELLS), sleep(FRAME_READ_MS).then(() => [])]).catch(() => []);
    tables.push(...cellTables(found).slice(0, MAX_TABLES - tables.length));
  }
  return tables;
}

type NotApproved = { status: typeof LOAN_DETAILS_NOT_APPROVED };
/** `loans` / `standingOrders` are untrusted here: the parent validates them (scraperIsolation's parseExtras). */
export interface LoanDetailsSource {
  read(page: Page, deadline: number): Promise<{ status: "READ" | "UNAVAILABLE"; loans?: unknown[]; rejected?: number } | NotApproved>;
}
export interface StandingOrderDetailsSource {
  read(page: Page, deadline: number): Promise<{ status: "READ" | "UNAVAILABLE"; standingOrders?: unknown[]; rejected?: number } | NotApproved>;
}

/** A department outside CONNECTION_DEPARTMENT_READ: answers without touching the page. */
export const NOT_APPROVED_DETAILS: LoanDetailsSource & StandingOrderDetailsSource = { read: () => Promise.resolve({ status: LOAN_DETAILS_NOT_APPROVED }) };

// The rows it could not place travel as a count only, so a partial read is never shown as complete.
const answer = <T>(parsed: TableParse<T>) => (parsed ? { status: "READ" as const, items: parsed.items, rejected: parsed.rejected } : { status: "UNAVAILABLE" as const });
const readWith = <T>(parse: (tables: CellTables) => TableParse<T>) => async (page: Page) => answer(parse(await readTables(page)));
const readLoans = readWith(parseLoanTables);
const readOrders = readWith(parseStandingOrderTables);

export const TABLE_LOAN_DETAILS: LoanDetailsSource = {
  read: async (page) => { const read = await readLoans(page); return read.status === "READ" ? { status: "READ", loans: read.items, rejected: read.rejected } : read; },
};
export const TABLE_STANDING_ORDER_DETAILS: StandingOrderDetailsSource = {
  read: async (page) => { const read = await readOrders(page); return read.status === "READ" ? { status: "READ", standingOrders: read.items, rejected: read.rejected } : read; },
};
