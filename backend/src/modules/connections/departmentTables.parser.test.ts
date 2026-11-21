import { describe, expect, it } from "vitest";
import { hasLongNumber, lastFour, MAX_STANDING_ORDERS, parseAmount, parseDate, parseLoanTables, parsePercent, parseStandingOrderTables, plainText } from "./departmentTables.parser";

// Made-up figures in the shapes Israeli banks print them; no real account.
describe("cell formats", () => {
  it("reads shekel amounts with ₪, commas, minus signs and parentheses, and nothing else", () => {
    expect(parseAmount("₪ 1,234.50")).toBe(1234.5);
    expect(parseAmount('12,000 ש"ח')).toBe(12000);
    expect(parseAmount("-350.00")).toBe(-350);
    expect(parseAmount("350.00-")).toBe(-350);
    expect(parseAmount("−350")).toBe(-350);
    expect(parseAmount("(1,000.25)")).toBe(-1000.25);
    expect(parseAmount("‏1,000‎")).toBe(1000);
    for (const bad of ["", "-", "לא ידוע", "1.2.3", "10/12/2026", "6.5%", "-1-", "12a"]) expect(parseAmount(bad), bad).toBeNull();
  });

  it("reads a plain percent and refuses a prime formula or an impossible rate", () => {
    expect(parsePercent("6.50%")).toBe(6.5);
    expect(parsePercent(" 4.25 % ")).toBe(4.25);
    for (const bad of ["פריים + 1.5", "P+1", "", "150", "שש"]) expect(parsePercent(bad), bad).toBeNull();
  });

  it("reads Israeli dates day-first, two- or four-digit years, and rejects a day that does not exist", () => {
    expect(parseDate("01/11/2026")).toBe("2026-11-01");
    expect(parseDate("1.2.27")).toBe("2027-02-01");
    expect(parseDate("15-03-2030")).toBe("2030-03-15");
    for (const bad of ["31/02/2026", "2026-11-01", "13/13/2026", "", "11/2026"]) expect(parseDate(bad), bad).toBeNull();
  });

  it("keeps only the last 4 digits of a number, and drops any 5+ digit run from a name", () => {
    expect(lastFour("12-345-678901")).toBe("8901");
    expect(lastFour("מס' 301")).toBe("301");
    expect(lastFour("ללא")).toBeNull();
    expect(plainText("ביטוח לאומי 12-345678")).toBe("ביטוח לאומי");
    expect(plainText('חברת החשמל בע"מ')).toBe('חברת החשמל בע"מ');
    expect(plainText("123456789")).toBeNull();
    expect(plainText("x".repeat(90))).toHaveLength(60);
  });

  it("counts a number's digits across separators, with the same rule the parent's schema applies", () => {
    for (const long of ["12-345-678", "1234-5678", "12 345 678", "12/345.6", "12׳345״6", "1,234,5"]) {
      expect(hasLongNumber(`חשמל ${long}`), long).toBe(true);
      expect(plainText(`חשמל ${long}`), long).toBe("חשמל");
    }
    for (const short of ["חשמל 12-34", "מס' 301 שנת 2026", "1234"]) expect(hasLongNumber(short), short).toBe(false);
    for (const text of ["ועד 12-345-6789 בית 2026 א 99999", "x 1 2 3 4 5 y"]) expect(hasLongNumber(plainText(text) ?? "")).toBe(false);
  });
});

describe("parseLoanTables", () => {
  const HEADER = ["מספר הלוואה", "מס' מסלול", "מסלול", "סכום מקורי", "יתרת קרן", "שיעור ריבית", "תשלום חודשי", "מועד תשלום הבא", "תשלומים ששולמו", "מס' תשלומים", "תאריך סיום"];
  const ROW = ["12-345-678901", "301", "פריים + 0.5 לא צמוד", "₪ 120,000.00", "84,250.10", "פריים + 0.5", "2,015.40", "10/12/2026", "36", "120", "10/11/2033"];

  it("reads one snapshot per track row: last 4 digits, unknowns null, no schedule", () => {
    const parsed = parseLoanTables([[["ההלוואות שלי"], HEADER, ROW]]);
    expect(parsed).toEqual({ rejected: 0, items: [{
      loanNumber: "8901", trackNumber: "301", name: "פריים + 0.5 לא צמוד", asOf: null, originalAmount: 120000, principalBalance: 84250.1, indexedBalance: null,
      interestType: "prime", annualInterestRate: null, primeMargin: 0.5, indexLinked: false, baseIndex: null, baseIndexMonth: null,
      paymentsMade: 36, paymentsTotal: 120, startDate: null, endDate: "2033-11-10", nextPaymentAmount: 2015.4, nextPaymentDate: "2026-12-10", schedule: [],
    }] });
    expect(JSON.stringify(parsed)).not.toMatch(/345|678901/);
  });

  it("knows the banks' other labels, a fixed rate, CPI linkage and a count of payments left", () => {
    const header = ["מס' הלוואה", "סוג הלוואה", "סוג ריבית", "ריבית", "הצמדה", "סכום ההלוואה", "יתרה לסילוק", "יתרה משוערכת", "החזר חודשי", "תשלום הבא", "תשלומים שנותרו", "מספר תשלומים", "מועד סיום"];
    const row = ["7788", "הלוואה לרכב", "קבועה", "4.9%", "צמוד למדד", "50,000", "31,000", "32,500.75", "1,100", "05.01.27", "30", "48", "05/06/2029"];
    expect(parseLoanTables([[header, row]])?.items[0]).toMatchObject({
      loanNumber: "7788", name: "הלוואה לרכב", interestType: "fixed", annualInterestRate: 4.9, primeMargin: null, indexLinked: true,
      originalAmount: 50000, principalBalance: null, indexedBalance: 32500.75, nextPaymentAmount: 1100, nextPaymentDate: null, paymentsMade: 18, paymentsTotal: 48, endDate: "2029-06-05",
    });
  });

  // Banker 2026-11-14: a payoff amount includes early-repayment fees, accrued interest and linkage — never the principal.
  it("never takes a payoff column for the principal: payoff only → principal null, payoff and principal → the principal", () => {
    for (const payoff of ["יתרה לסילוק", "סכום לסילוק", "סכום לסילוק מוקדם", "לסילוק", "סכום פירעון מוקדם"]) {
      const onlyPayoff = parseLoanTables([[["מספר הלוואה", payoff, "תשלום חודשי"], ["1234", "90,500", "1,000"]]]);
      expect(onlyPayoff?.items[0], payoff).toMatchObject({ principalBalance: null, indexedBalance: null, nextPaymentAmount: 1000 });
      const both = parseLoanTables([[["מספר הלוואה", payoff, "יתרת קרן"], ["1234", "90,500", "88,000"]]]);
      expect(both?.items[0], payoff).toMatchObject({ principalBalance: 88000, indexedBalance: null });
    }
    // A payoff as the page's only amount is no snapshot at all.
    expect(parseLoanTables([[["מספר הלוואה", "יתרה לסילוק"], ["1234", "90,500"]]])).toBeNull();
    expect(parseLoanTables([[["מספר הלוואה", "קרן"], ["1234", "70,000"]]])?.items[0].principalBalance).toBe(70000);
  });

  it("never feeds arrears, a ceiling or a principal part into a balance or a payment", () => {
    const parsed = parseLoanTables([[["מספר הלוואה", "סכום בפיגור", "תקרה", "סכום מרבי", "החזר קרן", "יתרה", "תשלום חודשי"], ["1234", "500", "100,000", "120,000", "800", "60,000", "1,050"]]]);
    expect(parsed?.items[0]).toMatchObject({ principalBalance: 60000, originalAmount: null, indexedBalance: null, nextPaymentAmount: 1050 });
    expect(parseLoanTables([[["מספר הלוואה", "סכום בפיגור", "סכום מרבי"], ["1234", "500", "120,000"]]])).toBeNull();
  });

  // QA 2026-11-16: every excluded column is out, not only the first; a label with an excluded word is never matched.
  it.each([
    [["מספר הלוואה", "יתרה לסילוק", "החזר קרן", "תשלום חודשי"], ["1234", "100,000", "800", "1,200"], { principalBalance: null, nextPaymentAmount: 1200 }],
    [["מספר הלוואה", "סכום בפיגור", "תשלום קרן", "תשלום חודשי"], ["1234", "500", "800", "1,200"], { principalBalance: null, nextPaymentAmount: 1200 }],
    [["מספר הלוואה", "יתרה לסילוק", "יתרה בפיגור", "תשלום חודשי"], ["1234", "100,000", "2,500", "1,200"], { principalBalance: null, nextPaymentAmount: 1200 }],
    [["מספר הלוואה", "סכום לסילוק", "תקרת יתרה", "החזר חודשי"], ["1234", "100,000", "5,000", "1,200"], { principalBalance: null, nextPaymentAmount: 1200 }],
    [["מספר הלוואה", "יתרה לסילוק", "סכום תשלום בפיגור", "יתרת קרן"], ["1234", "100,000", "2,500", "90,000"], { principalBalance: 90000, nextPaymentAmount: null }],
  ])("excludes every payoff, arrears, ceiling and principal-part column: %j", (header, row, expected) => {
    expect(parseLoanTables([[header, row]])?.items[0]).toMatchObject({ ...expected, indexedBalance: null, originalAmount: null });
  });

  // Banker 2026-11-16: an interest amount or an effective rate is never the loan's rate.
  it("never takes an interest amount or an effective rate for the annual rate", () => {
    expect(parseLoanTables([[["מספר הלוואה", "ריבית צבורה", "יתרת קרן"], ["1234", "45.20", "1,000"]]])?.items[0]).toMatchObject({ annualInterestRate: null, principalBalance: 1000 });
    for (const label of ["סכום ריבית", "ריבית לתשלום", "ריבית שנצברה", "ריבית ששולמה", "תשלום ריבית", "ריבית אפקטיבית", "שיעור ריבית אפקטיבית"]) {
      expect(parseLoanTables([[["מספר הלוואה", label, "יתרת קרן"], ["1234", "45.20", "1,000"]]])?.items[0].annualInterestRate, label).toBeNull();
    }
    expect(parseLoanTables([[["מספר הלוואה", "ריבית אפקטיבית", "ריבית", "יתרת קרן"], ["1234", "7.1", "6.5", "1,000"]]])?.items[0].annualInterestRate).toBe(6.5);
  });

  it("never takes a balance including interest for the principal, and keeps the linked balance", () => {
    for (const label of ["יתרה כולל ריבית", "יתרה כוללת", "יתרת חוב כוללת"]) {
      expect(parseLoanTables([[["מספר הלוואה", label, "תשלום חודשי"], ["1234", "90,000", "1,000"]]])?.items[0], label).toMatchObject({ principalBalance: null, indexedBalance: null });
    }
    expect(parseLoanTables([[["מספר הלוואה", "יתרה כולל הצמדה", "תשלום חודשי"], ["1234", "90,000", "1,000"]]])?.items[0]).toMatchObject({ principalBalance: null, indexedBalance: 90000 });
  });

  it("takes a linked balance only from its own label, and never derives one", () => {
    expect(parseLoanTables([[["מספר הלוואה", "יתרת קרן", "יתרה כולל הצמדה", "הצמדה"], ["1234", "50,000", "53,100", "צמוד למדד"]]])?.items[0])
      .toMatchObject({ principalBalance: 50000, indexedBalance: 53100, indexLinked: true });
    expect(parseLoanTables([[["מספר הלוואה", "יתרת קרן", "הצמדה"], ["1234", "50,000", "צמוד למדד"]]])?.items[0]).toMatchObject({ indexedBalance: null, indexLinked: true });
  });

  it("a prime margin alone is no rate: rate null, margin set", () => {
    for (const [cell, margin] of [["פריים + 1.5", 1.5], ["P-0.5", -0.5], ["פריים − 0.25", -0.25]] as const) {
      expect(parseLoanTables([[["מספר הלוואה", "ריבית", "יתרת קרן"], ["1234", cell, "1,000"]]])?.items[0], cell).toMatchObject({ annualInterestRate: null, primeMargin: margin, interestType: "prime" });
    }
    expect(parseLoanTables([[["מספר הלוואה", "שיעור ריבית", "מרווח", "יתרת קרן"], ["1234", "6.5%", "+0.5", "1,000"]]])?.items[0]).toMatchObject({ annualInterestRate: 6.5, primeMargin: 0.5 });
  });

  it("takes a prime margin from its own column, and a variable rate as variable", () => {
    const parsed = parseLoanTables([[["מספר הלוואה", "סוג ריבית", "מרווח", "יתרה"], ["1", "משתנה כל 5 שנים", "-0.25", "1,000"], ["2", "פריים", "+1.5%", "2,000"]]]);
    expect(parsed?.items.map(({ interestType, primeMargin }) => [interestType, primeMargin])).toEqual([["variable", -0.25], ["prime", 1.5]]);
  });

  it("is UNAVAILABLE without its identifier or any amount column, and for a table it does not know", () => {
    expect(parseLoanTables([[["מסלול", "יתרת קרן"], ["פריים", "1,000"]]])).toBeNull();
    expect(parseLoanTables([[["מספר הלוואה", "מסלול", "שיעור ריבית"], ["1234", "פריים", "6%"]]])).toBeNull();
    expect(parseLoanTables([[["תאריך", "תיאור", "סכום"], ["01/11/2026", "שופרסל", "50"]]])).toBeNull();
    expect(parseLoanTables([])).toBeNull();
    // A header with no data rows may be a page still loading: never a claim that she has no loans.
    expect(parseLoanTables([[HEADER]])).toBeNull();
  });

  it("skips totals and repeated headers, and rejects a row without a number or out of line with its header", () => {
    const parsed = parseLoanTables([[HEADER, ROW, HEADER, ['סה"כ', "", "", "120,000", "84,250.10", "", "2,015.40", "", "", "", ""], ["ללא", ...ROW.slice(1)], ROW.slice(0, 5)]]);
    expect(parsed).toMatchObject({ rejected: 2, items: [{ loanNumber: "8901" }] });
  });

  it("keeps a missing optional field null, never 0", () => {
    const parsed = parseLoanTables([[["מספר הלוואה", "יתרת קרן", "תשלום חודשי"], ["4455", "1,000", "-"]]]);
    expect(parsed?.items[0]).toMatchObject({ principalBalance: 1000, nextPaymentAmount: null, paymentsMade: null, paymentsTotal: null, interestType: null, indexLinked: null });
  });

  it("reads the same table shown twice once", () => {
    expect(parseLoanTables([[HEADER, ROW], [HEADER, ROW]])?.items).toHaveLength(1);
  });
});

describe("parseStandingOrderTables", () => {
  const HEADER = ["שם המוטב", "מספר חשבון מוטב", "סכום", "יום חיוב", "סוג", "סטטוס", "אסמכתא", "חיוב אחרון"];

  it("reads each order: payee, amount, day, kind, status, last 4 of the reference, last charge", () => {
    const parsed = parseStandingOrderTables([[HEADER,
      ["ועד הבית", "12-345-678901", "₪ 250.00", "10", "הוראת קבע", "פעיל", "98765432", "10/10/2026"],
      ['חברת החשמל בע"מ', "", "", "15 לחודש", "הרשאה לחיוב חשבון", "לא פעיל", "1234", "15.09.26"],
    ]]);
    expect(parsed).toEqual({ rejected: 0, items: [
      { payee: "ועד הבית", amount: 250, dayOfMonth: 10, kind: "standing_order", status: "active", reference: "5432", lastChargeDate: "2026-10-10" },
      { payee: 'חברת החשמל בע"מ', amount: null, dayOfMonth: 15, kind: "direct_debit", status: "inactive", reference: "1234", lastChargeDate: "2026-09-15" },
    ] });
    expect(JSON.stringify(parsed)).not.toMatch(/678901|9876/);
  });

  it("knows other labels, takes the day from a charge date, and leaves what it cannot read null", () => {
    const header = ["לטובת", "סכום החיוב", "סכום חיוב אחרון", "מועד חיוב", "מצב", "מספר הרשאה", "קוד מוסד"];
    expect(parseStandingOrderTables([[header, ["ביטוח בריאות", "", "89.90", "03/11/2026", "בתוקף", "ID-12", "55555"]]])?.items).toEqual([
      { payee: "ביטוח בריאות", amount: null, dayOfMonth: 3, kind: null, status: "active", reference: "12", lastChargeDate: null },
    ]);
  });

  it("is UNAVAILABLE without a payee, with a payee alone, or for a table it does not know", () => {
    expect(parseStandingOrderTables([[["סכום", "יום חיוב"], ["250", "10"]]])).toBeNull();
    expect(parseStandingOrderTables([[["שם המוטב", "הערות"], ["ועד הבית", "-"]]])).toBeNull();
    expect(parseStandingOrderTables([[["תאריך", "תיאור", "חובה", "זכות"], ["01/11/2026", "ועד הבית", "250", ""]]])).toBeNull();
    expect(parseStandingOrderTables([[HEADER]])).toBeNull();
  });

  it("rejects a row whose payee is only a number, and a day that is not one", () => {
    const parsed = parseStandingOrderTables([[HEADER, ["123456789", "", "10", "10", "", "", "", ""], ["גן ילדים", "", "1,800", "32", "", "", "", ""]]]);
    expect(parsed).toEqual({ rejected: 1, items: [{ payee: "גן ילדים", amount: 1800, dayOfMonth: null, kind: null, status: null, reference: null, lastChargeDate: null }] });
  });

  it("never takes a direct debit's ceiling for its amount, and reads 0 as no fixed amount", () => {
    for (const ceiling of ["סכום מרבי", "תקרת חיוב", "תקרה", "סכום מקסימלי", "סכום מקסימום", "גבול חיוב"]) {
      const parsed = parseStandingOrderTables([[["שם המוטב", ceiling, "יום חיוב"], ["ביטוח", "1,000", "5"]]]);
      expect(parsed?.items[0], ceiling).toMatchObject({ amount: null, dayOfMonth: 5 });
    }
    expect(parseStandingOrderTables([[["שם המוטב", "סכום", "סכום מרבי"], ["ביטוח", "120", "1,000"]]])?.items[0].amount).toBe(120);
    expect(parseStandingOrderTables([[["שם המוטב", "סכום", "יום חיוב"], ["ביטוח", "0.00", "5"]]])?.items[0].amount).toBeNull();
  });

  it("is UNAVAILABLE past its cap rather than handing back part of the list", () => {
    const rows = (n: number) => Array.from({ length: n }, (_, i) => [`מוטב ${String.fromCharCode(0x05d0 + (i % 22))}${i}`, "", "10", "1", "", "", "", ""]);
    expect(parseStandingOrderTables([[HEADER, ...rows(MAX_STANDING_ORDERS)]])?.items).toHaveLength(MAX_STANDING_ORDERS);
    expect(parseStandingOrderTables([[HEADER, ...rows(MAX_STANDING_ORDERS + 1)]])).toBeNull();
  });
});
