import { z } from "zod";
import { prisma } from "../../config/database";
import { AMOUNT_TOLERANCE, canonicalPayee, normalizePayee } from "../bank/statementCommitments.detector";
import { createDetectedRecurring, SAME_PAYMENT_RATIO, sameDay, statementCommitmentsService, untracked } from "../bank/statementCommitments.service";
import type { DetectedCommitment } from "../../types/commitments.types";
import type { ScrapedStandingOrder } from "../../types/connections.types";
import type { StandingOrderMatchReason, StandingOrderPreviewItem, StandingOrdersPreview } from "../../types/siteSnapshot.types";

// The banker's rule (2026-11-14): the bank's list only labels what the checking debits already prove (CLAUDE.md §4, §7 A2).
const FORMAT = "bank-site-standing-orders-v1";
// A payee contained in a longer one is the same payee only when it is not a fragment of it ("חשמל" in "חברת החשמל לישראל").
const MIN_CONTAINED_PAYEE = 4;

const orderSchema = z.strictObject({
  payee: z.string().min(1).max(60), amount: z.number().finite().positive().nullable(), dayOfMonth: z.number().int().min(1).max(31).nullable(),
  kind: z.enum(["standing_order", "direct_debit"]).nullable(), status: z.enum(["active", "inactive"]).nullable(),
  reference: z.string().regex(/^\d{1,4}$/).nullable(), lastChargeDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
});
const fileSchema = z.strictObject({ format: z.literal(FORMAT), orders: z.array(orderSchema).min(1).max(100) });

export function standingOrdersFile(orders: ScrapedStandingOrder[]): Buffer {
  const sorted = orders.map((o) => orderSchema.parse(o)).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return Buffer.from(JSON.stringify({ format: FORMAT, orders: sorted }), "utf8");
}

export function readStandingOrdersFile(buffer: Buffer): ScrapedStandingOrder[] | null {
  try {
    const parsed = fileSchema.safeParse(JSON.parse(buffer.toString("utf8")));
    return parsed.success ? parsed.data.orders : null;
  } catch {
    return null;
  }
}

/** "same" names one payee; "fragment" might, and is left for her rather than matched. */
export function payeeLink(a: string, b: string): "same" | "fragment" | null {
  const x = canonicalPayee(a);
  const y = canonicalPayee(b);
  if (!x || !y) return null;
  if (x === y) return "same";
  const [shorter, longer] = x.length <= y.length ? [x, y] : [y, x];
  if (!longer.includes(shorter)) return null;
  return shorter.length >= MIN_CONTAINED_PAYEE && shorter.length * 2 >= longer.length ? "same" : "fragment";
}

function amountFits(order: ScrapedStandingOrder, debit: number): boolean {
  if (order.amount === null) return true;
  if (order.kind === "direct_debit") return Math.max(order.amount, debit) / Math.min(order.amount, debit) <= AMOUNT_TOLERANCE;
  return Math.abs(order.amount - debit) <= debit * SAME_PAYMENT_RATIO;
}

export interface OrderMatch { commitment: DetectedCommitment | null; reason: StandingOrderMatchReason; }

/** Each order to at most one recurring debit and back; any doubt either way is "ambiguous", never a pick. */
export function matchStandingOrders(orders: ScrapedStandingOrder[], recurring: DetectedCommitment[]): OrderMatch[] {
  const candidates = orders.map((order) => recurring.filter((c) => c.kind === "recurring" && payeeLink(order.payee, c.name) !== null && amountFits(order, c.amount)
    && (order.dayOfMonth === null || sameDay(order.dayOfMonth, c.dayOfMonth))));
  const claims = new Map<string, number>();
  for (const list of candidates) for (const c of list) claims.set(c.key, (claims.get(c.key) ?? 0) + 1);
  return orders.map((order, i): OrderMatch => {
    const list = candidates[i];
    if (!list.length) return { commitment: null, reason: "no_checking_debit" };
    const only = list[0];
    if (list.length > 1 || claims.get(only.key)! > 1 || payeeLink(order.payee, only.name) === "fragment") return { commitment: null, reason: "ambiguous" };
    return { commitment: only, reason: "matched" };
  });
}

interface Evaluated { preview: StandingOrdersPreview; matches: OrderMatch[]; }

async function evaluate(userId: number, accountId: number, orders: ScrapedStandingOrder[]): Promise<Evaluated> {
  const recurring = (await statementCommitmentsService.found(userId, accountId)).filter((c) => c.kind === "recurring");
  const matches = matchStandingOrders(orders, recurring);
  const keys = matches.flatMap((m) => (m.commitment ? [m.commitment.key] : []));
  const [saved, dismissed, open] = await Promise.all([
    prisma.recurringPayment.findMany({ where: { userId, detectedKey: { in: keys } }, select: { id: true, detectedKey: true } }),
    prisma.dismissedCommitment.findMany({ where: { userId, key: { in: keys } }, select: { key: true } }),
    untracked(userId, recurring),
  ]);
  const seen = new Map<string, number>();
  const items = orders.map((order, i): StandingOrderPreviewItem => {
    const base = `order:${normalizePayee(order.payee).slice(0, 60) || "-"}:${order.reference ?? "-"}:${order.dayOfMonth ?? "-"}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    const c = matches[i].commitment;
    const recurringPaymentId = c ? saved.find((r) => r.detectedKey === c.key)?.id ?? null : null;
    // Tracked another way (her own entry of the same payee) or dismissed: adding would be a twin, or undo her "no".
    const canAdd = !!c && recurringPaymentId === null && order.status !== "inactive" && open.some((o) => o.key === c.key) && !dismissed.some((d) => d.key === c.key);
    return {
      key: n ? `${base}:${n + 1}` : base, payee: order.payee, amount: order.amount, dayOfMonth: order.dayOfMonth, kind: order.kind, status: order.status,
      match: { detectedKey: c?.key ?? null, name: c?.name ?? null, lastDebitDate: c?.lastDate ?? null, reason: matches[i].reason, recurringPaymentId, canAdd },
    };
  });
  return { preview: { kind: "standing_orders", orders: items }, matches };
}

export const standingOrdersService = {
  preview: (userId: number, accountId: number, orders: ScrapedStandingOrder[]) => evaluate(userId, accountId, orders).then((e) => e.preview),

  /**
   * Labels only: a saved payment gets the verification columns, never the site's amount or dates.
   * A matched debit not saved yet is added — from the checking debit — only if she ticked it.
   */
  async apply(userId: number, accountId: number, orders: ScrapedStandingOrder[], accept: string[], verifiedDay: string) {
    const { preview, matches } = await evaluate(userId, accountId, orders);
    const ticked = new Set(accept);
    let labelled = 0;
    let added = 0;
    for (const [i, item] of preview.orders.entries()) {
      const c = matches[i].commitment;
      if (!c) continue;
      const order = orders[i];
      const labels = { verifiedAt: new Date(`${verifiedDay}T00:00:00Z`), verifiedSource: "bank_site", debitKind: order.kind, bankStatus: order.status, bankReference: order.reference };
      if (item.match.recurringPaymentId !== null) {
        await prisma.recurringPayment.update({ where: { id: item.match.recurringPaymentId }, data: labels });
        labelled++;
      } else if (item.match.canAdd && ticked.has(item.key)) {
        await createDetectedRecurring(userId, c, labels);
        added++;
      }
    }
    console.log(`[הוראות קבע מאתר הבנק] ${preview.orders.length} הוראות: ${labelled} סומנו כמאומתות, ${added} נוספו, ${preview.orders.filter((o) => o.match.reason === "no_checking_debit").length} בלי חיוב בעו״ש`);
    return { preview, labelled, added };
  },
};
