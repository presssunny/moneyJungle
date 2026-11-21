import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import puppeteer, { type Browser, type Page } from "puppeteer";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cellTables, MAX_CELL_TEXT, readTables, TABLE_CELLS, TABLE_LOAN_DETAILS, TABLE_STANDING_ORDER_DETAILS, type LoanDetailsSource, type StandingOrderDetailsSource } from "./departmentRead";
import { parseLoanTables, parseStandingOrderTables } from "./departmentTables.parser";
import { departmentFollowUp, NOT_APPROVED_LOAN_DETAILS } from "./officialLogin";
import { stillLanded } from "./siteDiscovery";
import { FIXTURES_DIR } from "../../testing/fixtures";
// Offline: every request is answered by the test or aborted, so nothing reaches the bank.
import { LOANS, LOGIN_AGAIN, ORIGIN, PORTAL, seenRoutes, shell, signedIn, signedInPage } from "../../testing/mockBankPortal";

let browser: Browser;
beforeAll(async () => { browser = await puppeteer.launch({ headless: true }); });
afterAll(async () => { await browser.close(); });

async function cellsOf(html: string): Promise<string[][][]> {
  const page = await browser.newPage();
  try {
    await page.setContent(`<meta charset="utf-8">${html}`);
    return cellTables(await page.evaluate(TABLE_CELLS));
  } finally {
    await page.close();
  }
}

describe("TABLE_CELLS in a real Chrome page (CLAUDE.md §7 A2)", () => {
  it("returns the shown text of th/td cells only, never what a form control holds", async () => {
    const tables = await cellsOf(`<p>שלום דנה, חשבון 12-345678</p>
      <table><thead><tr><th>שם המוטב</th><th>סכום</th><th>הערה</th></tr></thead><tbody>
        <tr><td> ועד   הבית </td><td>₪ 250.00</td><td><input id="typed" value="default-9f"></td></tr>
        <tr><td><select><option>אפשרות-סודית</option></select></td><td><textarea>טקסט-שלה</textarea></td><td><button>פתח</button></td></tr>
        <tr><td><span contenteditable="true">עריכה-שלה</span></td><td>גלוי<span style="display:none">מוסתר-7c</span></td><td hidden>מוסתר-כולו</td></tr>
      </tbody></table>
      <div>מחוץ לטבלה 999</div>
      <script>document.getElementById("typed").value = "typed-by-her-42";</script>`);
    expect(tables).toEqual([[["שם המוטב", "סכום", "הערה"], ["ועד הבית", "₪ 250.00", ""], ["", "", ""], ["", "גלוי", ""]]]);
    const text = JSON.stringify(tables);
    for (const never of ["default-9f", "typed-by-her", "אפשרות-סודית", "טקסט-שלה", "פתח", "עריכה-שלה", "מוסתר", "דנה", "12-345678", "מחוץ"]) expect(text, never).not.toContain(never);
  }, 30_000);

  it("holds its caps: 20 tables, 200 rows, 12 cells, 80 characters", async () => {
    const row = (cells: number, text = "x") => `<tr>${Array.from({ length: cells }, () => `<td>${text}</td>`).join("")}</tr>`;
    const tables = await cellsOf(`<table>${Array.from({ length: 250 }, () => row(15)).join("")}</table><table>${row(1, "y".repeat(100))}</table>${Array.from({ length: 30 }, () => `<table>${row(1)}</table>`).join("")}`);
    expect(tables).toHaveLength(20);
    expect(tables[0]).toHaveLength(200);
    expect(tables[0].every((cells) => cells.length === 12)).toBe(true);
    expect(tables[1]).toEqual([["y".repeat(MAX_CELL_TEXT)]]);
  }, 30_000);

  it("reads a nested table's own rows once, and an outer cell only as its own capped text", async () => {
    const tables = await cellsOf(`<table><tr><td>חוץ</td><td><table><tr><td>פנים</td></tr></table></td></tr></table>`);
    expect(tables).toEqual([[["חוץ", "פנים"]], [["פנים"]]]);
  }, 30_000);

  it("reads the landed page and its same-origin frames, never another site's frame", async () => {
    const page = await browser.newPage();
    try {
      await page.setRequestInterception(true);
      page.on("request", (request) => {
        const url = request.url();
        const body = url === `${ORIGIN}/main` ? `<table><tr><td>ראשי</td></tr></table><iframe src="${ORIGIN}/inner"></iframe><iframe src="https://evil.example/frame"></iframe>`
          : url === `${ORIGIN}/inner` ? "<table><tr><td>פנימי</td></tr></table>"
          : url === "https://evil.example/frame" ? "<table><tr><td>זר</td></tr></table>" : null;
        void (body === null ? request.abort() : request.respond({ status: 200, contentType: "text/html; charset=utf-8", body }));
      });
      await page.goto(`${ORIGIN}/main`, { waitUntil: "load" });
      expect(page.frames()).toHaveLength(3);
      expect(await readTables(page)).toEqual([[["ראשי"]], [["פנימי"]]]);
    } finally {
      await page.close();
    }
  }, 30_000);

  it("drops an off-shape answer instead of trusting the page", () => {
    expect(cellTables("x")).toEqual([]);
    expect(cellTables([[["a", 1, null, { b: 2 }]], "row", [["c".repeat(200)]]])).toEqual([[["a", "", "", ""]], [["c".repeat(MAX_CELL_TEXT)]]]);
  });
});

const STANDING = "Online/OnStandingOrders/AuthStandingOrders";
const LOAN_TABLE = `<table><tr><th>מספר הלוואה</th><th>מסלול</th><th>יתרת קרן</th><th>תשלום חודשי</th><th>הערה</th></tr><tr><td>12-345-678901</td><td>פריים</td><td>84,250.10</td><td>2,015.40</td><td><input value="999999"></td></tr></table>`;
const ORDER_TABLE = `<table><tr><th>שם המוטב</th><th>סכום</th><th>יום חיוב</th><th>אסמכתא</th></tr><tr><td>ועד הבית</td><td>₪ 250.00</td><td>10</td><td>98765432</td></tr></table>`;
// The app swaps its view on each route, as the real one does.
const view = (html: string) => `(document.getElementById("view") || {}).remove?.(), document.body.insertAdjacentHTML("beforeend", ${JSON.stringify(`<main id="view">${html}</main>`)})`;

function counting<S extends LoanDetailsSource | StandingOrderDetailsSource>(source: S): S & { calls: number } {
  const counted = { calls: 0, read: (page: Page, deadline: number) => { counted.calls += 1; return source.read(page, deadline); } };
  return counted as unknown as S & { calls: number };
}

describe("departmentFollowUp with the table read (official window, offline)", () => {
  async function follow(portal: string, decision = { loans: true, standingOrders: true }, sources: { loans?: LoanDetailsSource; orders?: StandingOrderDetailsSource } = {}) {
    const { page, requested } = await signedInPage(browser, portal);
    const loanDetails = counting(sources.loans ?? TABLE_LOAN_DETAILS);
    const standingOrderDetails = counting(sources.orders ?? TABLE_STANDING_ORDER_DETAILS);
    try {
      const extras = await departmentFollowUp(page, { success: true }, { decide: async () => decision, signedIn, loanDetails, standingOrderDetails, budgetMs: 60_000 });
      return { extras, seen: seenRoutes(requested), requested, reads: [loanDetails.calls, standingOrderDetails.calls] };
    } finally {
      await page.close();
    }
  }

  it("lands on each department in turn and reads only its tables: last 4 digits, nothing she typed, nothing outside a table", async () => {
    const { extras, seen, requested, reads } = await follow(shell(view(LOAN_TABLE), view(ORDER_TABLE)));
    expect(extras).toEqual({
      loans: parseLoanTables([[["מספר הלוואה", "מסלול", "יתרת קרן", "תשלום חודשי", "הערה"], ["12-345-678901", "פריים", "84,250.10", "2,015.40", ""]]])!.items,
      standingOrders: [{ payee: "ועד הבית", amount: 250, dayOfMonth: 10, kind: null, status: null, reference: "5432", lastChargeDate: null }],
      followUp: { department: "landed", details: "READ", rejected: 0, standingOrders: { department: "landed", details: "READ", rejected: 0 } },
    });
    expect((extras.loans as Array<{ loanNumber: string }>)[0].loanNumber).toBe("8901");
    expect(seen).toEqual([LOANS, STANDING]);
    expect(reads).toEqual([1, 1]);
    const text = JSON.stringify(extras);
    for (const never of ["678901", "9876", "999999", "דנה", "12-345678"]) expect(text, never).not.toContain(never);
    for (const never of ["/__event/", "AuthCreditCardsDetails", "AuthDeposits", "LoanRequest", "evil.example"]) expect(requested.some((u) => u.includes(never)), never).toBe(false);
    expect(requested.every((u) => u.startsWith(`${ORIGIN}/`))).toBe(true);
  }, 60_000);

  it("a page without a table it knows is UNAVAILABLE, and the next department still goes ahead", async () => {
    const { extras, seen } = await follow(shell(view("<p>אין נתונים</p>"), view(ORDER_TABLE)));
    expect(extras.followUp).toEqual({ department: "landed", details: "UNAVAILABLE", standingOrders: { department: "landed", details: "READ", rejected: 0 } });
    expect(extras).not.toHaveProperty("loans");
    expect(seen).toEqual([LOANS, STANDING]);
  }, 60_000);

  it("hands back how many rows it could not place, as a count, so a partial read is never complete", async () => {
    const partial = ORDER_TABLE.replace("</table>", "<tr><td>123456789</td><td>10</td><td>1</td><td></td></tr><tr><td>גן</td></tr></table>");
    const { extras } = await follow(shell(view(LOAN_TABLE), view(partial)), { loans: false, standingOrders: true });
    expect(extras.followUp.standingOrders).toEqual({ department: "landed", details: "READ", rejected: 2 });
    expect(extras.standingOrders).toHaveLength(1);
    expect(JSON.stringify(extras)).not.toContain("123456789");
  }, 60_000);

  it("loans missing from the menu cost only loans", async () => {
    const { extras, seen } = await follow(shell(view(LOAN_TABLE), view(ORDER_TABLE)).replace(`<a href="#/${LOANS}">הלוואות ומשכנתאות</a>`, ""));
    expect(extras.followUp).toEqual({ department: "NOT_IN_MENU", details: "NOT_RUN", standingOrders: { department: "landed", details: "READ", rejected: 0 } });
    expect(seen).toEqual([STANDING]);
  }, 60_000);

  it.each([
    ["signs her out", `location.replace("${LOGIN_AGAIN}?returnUrl=/Resources/PortalNG/shell")`, "SESSION_LOST"],
    ["routes to a step of its own", `location.hash = "#/Online/Home"`, "REDIRECT"],
    ["shows a challenge", `location.replace("${ORIGIN}/captcha/check")`, "CHALLENGE"],
    ["opens a tab", `open("about:blank")`, "NEW_TAB"],
  ])("when the loans page %s: no read at all, and the standing orders department is stopped too", async (_case, onLoans, stop) => {
    const { extras, seen, reads } = await follow(shell(`{ ${view(LOAN_TABLE)}; ${onLoans}; }`, view(ORDER_TABLE)));
    expect(extras).toEqual({ followUp: { department: stop, details: "NOT_RUN", standingOrders: { department: stop, details: "NOT_RUN" } } });
    expect(reads).toEqual([0, 0]);
    expect(seen).not.toContain(STANDING);
  }, 60_000);

  it("a department outside the read list lands and reads nothing: NOT_APPROVED", async () => {
    const { extras, reads } = await follow(shell(view(LOAN_TABLE), view(ORDER_TABLE)), { loans: true, standingOrders: true }, { loans: NOT_APPROVED_LOAN_DETAILS });
    expect(extras.followUp).toEqual({ department: "landed", details: "NOT_APPROVED", standingOrders: { department: "landed", details: "READ", rejected: 0 } });
    expect(extras).not.toHaveProperty("loans");
    expect(reads).toEqual([1, 1]);
  }, 60_000);

  it("a department the parent did not ask for is never visited: NOT_NEEDED", async () => {
    const { extras, seen, reads } = await follow(shell(view(LOAN_TABLE), view(ORDER_TABLE)), { loans: false, standingOrders: true });
    expect(extras.followUp).toEqual({ department: "NOT_NEEDED", details: "NOT_RUN", standingOrders: { department: "landed", details: "READ", rejected: 0 } });
    expect(seen).toEqual([STANDING]);
    expect(reads).toEqual([0, 1]);
  }, 60_000);

  it("a read that hangs is cut at the budget: FAILED, and the follow-up still returns", async () => {
    const hang: StandingOrderDetailsSource = { read: () => new Promise(() => {}) };
    const { page } = await signedInPage(browser, shell(view(LOAN_TABLE), view(ORDER_TABLE)));
    const started = Date.now();
    try {
      const extras = await departmentFollowUp(page, { success: true }, { decide: async () => ({ loans: false, standingOrders: true }), signedIn, loanDetails: TABLE_LOAN_DETAILS, standingOrderDetails: hang, budgetMs: 40_000 });
      expect(extras.followUp.standingOrders).toEqual({ department: "landed", details: "FAILED" });
      expect(Date.now() - started).toBeLessThan(42_000);
    } finally {
      await page.close();
    }
  }, 60_000);
});

describe("stillLanded, the re-check right before a read", () => {
  const landed = `${PORTAL}#/${STANDING}`;
  const fakePage = ({ url = landed, frames = undefined as string[] | undefined, pages = 1, connected = true, closed = false } = {}) => {
    const page = {
      url: () => url,
      isClosed: () => closed,
      frames: () => (frames ?? [url]).map((frameUrl) => ({ url: () => frameUrl })),
      browser: () => ({ connected, pages: async () => Array.from({ length: pages }, () => page) }),
    };
    return page as unknown as Page;
  };

  it("passes only on the very URL it landed on, in the same tab, signed in", async () => {
    expect(await stillLanded(fakePage(), landed, 1, signedIn)).toBeNull();
    expect(await stillLanded(fakePage({ url: `${PORTAL}#/Online/Home` }), landed, 1, signedIn)).toBe("REDIRECT");
    expect(await stillLanded(fakePage({ pages: 2 }), landed, 1, signedIn)).toBe("NEW_TAB");
    expect(await stillLanded(fakePage({ connected: false }), landed, 1, signedIn)).toBe("CLOSED");
    expect(await stillLanded(fakePage({ closed: true }), landed, 1, signedIn)).toBe("CLOSED");
    expect(await stillLanded(fakePage({ url: `${LOGIN_AGAIN}?returnUrl=/Resources/PortalNG/shell` }), landed, 1, signedIn)).toBe("SESSION_LOST");
    expect(await stillLanded(fakePage({ frames: [landed, `${ORIGIN}/otp/verify`] }), landed, 1, signedIn)).toBe("SESSION_LOST");
    expect(await stillLanded(fakePage({ frames: [landed, "https://captcha.example/x"] }), landed, 1, signedIn)).toBe("CHALLENGE");
    expect(await stillLanded(fakePage({ url: "https://evil.example/Resources/PortalNG/shell" }), landed, 1, signedIn)).toBe("CHALLENGE");
  });
});

// Pages she saved herself from the bank's site (git-ignored, like every fixture): loans*.html / standing*.html.
const SITE_DIR = path.join(FIXTURES_DIR, "site");
const sitePages = existsSync(SITE_DIR) ? readdirSync(SITE_DIR).filter((name) => /^(loans|standing).*\.html$/.test(name)) : [];
describe.skipIf(!sitePages.length)("the parser on her saved department pages", () => {
  it.each(sitePages)("%s is recognised", async (name) => {
    const tables = await cellsOf(readFileSync(path.join(SITE_DIR, name), "utf8"));
    const parsed = name.startsWith("loans") ? parseLoanTables(tables) : parseStandingOrderTables(tables);
    expect(parsed, `${name}: tables=${tables.length}`).not.toBeNull();
    // Counts only: the values are hers.
    console.warn(`[בדיקה] ${name}: טבלאות=${tables.length} שורות=${parsed?.items.length ?? 0} נדחו=${parsed?.rejected ?? 0}`);
  }, 30_000);
});
