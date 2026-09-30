import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseBankStatementPdf } from "./bankParser.service";

const { pdf } = vi.hoisted(() => ({ pdf: vi.fn() }));
vi.mock("pdf-parse/lib/pdf-parse.js", () => ({ default: pdf }));

interface Token { str: string; transform: number[]; width: number }
interface InputRow { day: number; amount: number; balance: number | null; page?: number }
const token = (str: string, x: number, y: number): Token => ({ str, transform: [1, 0, 0, 1, x, y], width: 10 });
const daily: InputRow[] = [
  { day: 1, amount: 100, balance: 1000 },
  { day: 2, amount: -100, balance: 0 },
  { day: 2, amount: -200, balance: 700, page: 1 },
  { day: 3, amount: 50, balance: 0, page: 1 },
  { day: 3, amount: -150, balance: 600, page: 1 },
];

function document(rows: InputRow[], knownLayout = true) {
  const pages: Token[][] = [[
    token(knownLayout ? "https://www.fibi.co.il" : "https://example.test", 600, 800),
    token("תנועות בחשבון", 600, 780),
    ...[["תאריך", 700], ["תיאור", 600], ["זכות", 450], ["חובה", 350], ["יתרה", 250]].map(([s, x]) => token(String(s), Number(x), 750)),
  ]];
  rows.forEach((row, i) => {
    const page = row.page ?? 0;
    const y = 700 - i * 30;
    const tokens = pages[page] ?? (pages[page] = []);
    tokens.push(token(`${String(row.day).padStart(2, "0")}/09/2026`, 700, y), token("תנועה", 600, y), token(String(Math.abs(row.amount)), row.amount > 0 ? 450 : 350, y));
    if (row.balance !== null) tokens.push(token(String(row.balance), 250, y));
  });
  pdf.mockImplementation(async (_buffer: Buffer, options?: { pagerender: (page: { getTextContent: () => Promise<{ items: Token[] }> }) => Promise<string> }) => {
    if (!options) return { text: "" };
    for (const items of pages) await options.pagerender({ getTextContent: async () => ({ items }) });
    return { text: "" };
  });
  return parseBankStatementPdf(Buffer.from("%PDF-test"));
}

beforeEach(() => pdf.mockReset());

describe("PDF daily closing balances", () => {
  it("verifies zero placeholders across pages without changing physical amounts or directions", async () => {
    const parsed = await document(daily);
    expect(parsed.report.balanceMismatches).toHaveLength(0);
    expect(parsed.report.review).toHaveLength(0);
    expect(parsed.rows.map(row => row.type === "deposit" ? row.amount : -row.amount)).toEqual(daily.map(row => row.amount));
    expect(parsed.rows[1]).toMatchObject({ balance: null, balanceCheck: "chain", raw: { balance: 0 } });
  });

  it("derives opening from the first daily close when the document starts with a placeholder", async () => {
    const parsed = await document([{ day: 1, amount: -10, balance: 0 }, ...daily]);
    expect(parsed.report.balanceMismatches).toHaveLength(0);
    expect(parsed.report.openingBalance).toBe(910);
  });

  it("preserves a real zero in a valid per-transaction statement", async () => {
    const parsed = await document([{ day: 1, amount: 100, balance: 100 }, { day: 2, amount: -100, balance: 0 }, { day: 2, amount: 50, balance: 50 }, { day: 3, amount: 50, balance: 100 }]);
    expect(parsed.report.balanceMismatches).toHaveLength(0);
    expect(parsed.rows[1]).toMatchObject({ balance: 0, balanceCheck: "printed" });
  });

  it("keeps a genuine zero daily closing balance as an anchor", async () => {
    const parsed = await document([...daily.slice(0, -1), { ...daily[4]!, amount: -750, balance: 0 }]);
    expect(parsed.report.balanceMismatches).toHaveLength(0);
    expect(parsed.rows[4]).toMatchObject({ balance: 0, balanceCheck: "printed" });
    expect(parsed.report.closingBalance).toBe(0);
  });

  it.each(["wrong amount", "wrong sign", "missing row"])("does not hide a %s after the first anchor", async (problem) => {
    const rows = daily.map(row => ({ ...row }));
    if (problem === "wrong amount") rows[2]!.amount -= 1;
    if (problem === "wrong sign") rows[2]!.amount *= -1;
    if (problem === "missing row") rows.splice(1, 1);
    const parsed = await document(rows);
    expect(parsed.report.balanceMismatches.length).toBeGreaterThan(0);
  });

  it("does not infer a daily layout from a single day", async () => {
    const parsed = await document(daily.filter(row => row.day === 2));
    expect(parsed.report.balanceMismatches.length).toBeGreaterThan(0);
    expect(parsed.rows[0]!.balance).toBe(0);
  });

  it("does not discard zero balances in an unknown layout", async () => {
    const parsed = await document(daily, false);
    expect(parsed.report.balanceMismatches.length).toBeGreaterThan(0);
  });

  it("does not infer daily balances when a closing balance is missing", async () => {
    const parsed = await document([...daily.slice(0, -1), { ...daily[4]!, balance: null }]);
    expect(parsed.report.balanceMismatches.length).toBeGreaterThan(0);
  });

  it("does not treat a mixed layout as daily closing balances", async () => {
    const parsed = await document(daily.map((row, i) => i === 1 ? { ...row, balance: 900 } : row));
    expect(parsed.report.balanceMismatches.length).toBeGreaterThan(0);
  });
});
