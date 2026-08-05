import { prisma } from "../../config/database";
import { decimalToNumber, round2 } from "../../utils/money.utils";
import { creditCardRefOf } from "./bankParser.service";

/**
 * Is a card settlement already itemized in the credit module? It cuts both ways:
 * keep it and an itemized card double-counts (CLAUDE.md §4), drop it and an
 * un-imported card loses money that really left — as card 3704 did, 5,852.85 ₪.
 */

/** The card company's charge date and the bank debit differ by a day or two. */
const CHARGE_MATCH_DAYS = 5;
/** A line that names no card at all is matched to a charge date only this close. */
const ISSUER_ONLY_MATCH_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function monthKeyOf(date: Date): string {
  return date.toISOString().slice(0, 7);
}

/**
 * The card label inside a credit row's raw statement data ("ויזה 2349"). Column
 * position differs per issuer export, so every raw value is scanned instead of
 * trusting an index.
 */
function cardLabelOf(raw: unknown): string | null {
  if (raw === null || typeof raw !== "object") return null;
  for (const value of Object.values(raw as Record<string, unknown>)) {
    if (typeof value !== "string") continue;
    const ref = creditCardRefOf(value);
    if (ref.last4 !== null && ref.issuer !== null) return value.replace(/\s+/g, " ").trim();
  }
  return null;
}

interface CardFacts {
  last4: string;
  label: string;
  /** Charge dates seen for this card (when the export carries מועד חיוב). */
  chargeDays: string[];
  /** Attribution months, used when the export has no charge date at all. */
  billingMonths: Set<string>;
  itemizedTotal: number;
  rows: number;
}

export interface CoverageVerdict {
  covered: boolean;
  /** Hebrew reason, stored on the bank row so the screen can state it. */
  reason: string;
  cardLabel: string | null;
}

export interface CreditCoverage {
  /** Every card the credit module actually has data for. */
  cards: CardFacts[];
  verdictFor(row: { transactionDate: Date; description: string | null }): CoverageVerdict;
}

function withinDays(days: string[], date: Date, tolerance: number): boolean {
  const target = date.getTime();
  return days.some((day) => Math.abs(new Date(`${day}T00:00:00.000Z`).getTime() - target) <= tolerance * DAY_MS);
}

/**
 * Build the coverage view once per reconciliation pass. Only confirmed imports
 * count: a draft import is not yet a statement the user stands behind, so its
 * rows must not silence a real bank debit.
 */
export async function buildCreditCoverage(userId: number): Promise<CreditCoverage> {
  const rows = await prisma.creditTransaction.findMany({
    where: { userId, creditImport: { status: "confirmed" } },
    select: {
      amount: true,
      billingDate: true,
      chargeDate: true,
      transactionType: true,
      rawData: true,
    },
  });

  const byCard = new Map<string, CardFacts>();
  const allChargeDays: string[] = [];
  for (const row of rows) {
    const label = cardLabelOf(row.rawData);
    const last4 = label ? creditCardRefOf(label).last4 : null;
    if (row.chargeDate) allChargeDays.push(dayKey(row.chargeDate));
    if (last4 === null) continue;
    let facts = byCard.get(last4);
    if (!facts) {
      facts = {
        last4,
        label: label ?? last4,
        chargeDays: [],
        billingMonths: new Set<string>(),
        itemizedTotal: 0,
        rows: 0,
      };
      byCard.set(last4, facts);
    }
    if (row.chargeDate) facts.chargeDays.push(dayKey(row.chargeDate));
    facts.billingMonths.add(monthKeyOf(row.billingDate));
    // Financing lines are internal card movements, excluded from every total.
    if (row.transactionType !== "financing") {
      facts.itemizedTotal = round2(facts.itemizedTotal + decimalToNumber(row.amount));
    }
    facts.rows += 1;
  }

  const cards = [...byCard.values()].sort((a, b) => a.last4.localeCompare(b.last4));

  return {
    cards,
    verdictFor(row) {
      const ref = creditCardRefOf(row.description);
      if (ref.last4 !== null) {
        const facts = byCard.get(ref.last4);
        if (!facts) {
          return {
            covered: false,
            cardLabel: ref.last4,
            reason: `אין דוח אשראי מיובא לכרטיס ${ref.last4} — החיוב נספר כהוצאה כדי שהכסף לא ייעלם`,
          };
        }
        if (facts.chargeDays.length > 0) {
          const covered = withinDays(facts.chargeDays, row.transactionDate, CHARGE_MATCH_DAYS);
          return covered
            ? {
                covered: true,
                cardLabel: facts.label,
                reason: `מפורט בטאב אשראי (${facts.label}) — מוחרג כדי למנוע כפל ספירה`,
              }
            : {
                covered: false,
                cardLabel: facts.label,
                reason: `לכרטיס ${facts.label} אין חיוב מיובא בסמוך ל-${dayKey(row.transactionDate)} — החיוב נספר כהוצאה`,
              };
        }
        // No charge dates in the export: fall back to the attribution month.
        const covered = facts.billingMonths.has(monthKeyOf(row.transactionDate));
        return covered
          ? {
              covered: true,
              cardLabel: facts.label,
              reason: `מפורט בטאב אשראי (${facts.label}) לחודש ${monthKeyOf(row.transactionDate)} — מוחרג כדי למנוע כפל ספירה`,
            }
          : {
              covered: false,
              cardLabel: facts.label,
              reason: `לכרטיס ${facts.label} אין עסקאות מיובאות בחודש ${monthKeyOf(row.transactionDate)} — החיוב נספר כהוצאה`,
            };
      }
      // The line names no card (e.g. "עפ״י הרשאה כאל"): accept it as settled only
      // when a card statement really was charged within a day or two.
      const covered = withinDays(allChargeDays, row.transactionDate, ISSUER_ONLY_MATCH_DAYS);
      return covered
        ? {
            covered: true,
            cardLabel: ref.issuer,
            reason: `חיוב אשראי בסמוך למועד חיוב של דוח מיובא — מוחרג כדי למנוע כפל ספירה`,
          }
        : {
            covered: false,
            cardLabel: ref.issuer,
            reason: `חיוב אשראי ללא כרטיס מזוהה ובלי דוח מיובא בסמוך — נספר כהוצאה`,
          };
    },
  };
}
