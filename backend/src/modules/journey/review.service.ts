import { prisma } from "../../config/database";
import { reconciliationService } from "../bank/reconciliation.service";
import { fingerprint } from "./journey.utils";
export interface ReviewItem { key: string; title: string; to: string; blocking: boolean; fingerprint: string }
export async function review(userId: number): Promise<ReviewItem[]> {
  const [bank, credit, sessions, uncategorized] = await Promise.all([
    reconciliationService.getReconciliation(userId),
    prisma.creditImport.findMany({ where: { userId, status: { not: "confirmed" } }, orderBy: { id: "asc" } }),
    prisma.importSession.findMany({ where: { userId, status: { notIn: ["completed", "cancelled"] } }, orderBy: { createdAt: "asc" } }),
    prisma.expense.count({ where: { userId, categoryId: null } }),
  ]);
  const items: Omit<ReviewItem,"fingerprint">[] = [
    ...sessions.map(s => ({ key: `session:${s.id}`, title: `${s.fileName} — ${s.status === "recovery" ? "הקליטה נעצרה ויש לבדוק את תוצאותיה" : "המשך קליטה ובדיקה"}`, to: `/imports?session=${s.id}`, blocking: true })),
    ...credit.map(c => ({ key: `credit:${c.id}`, title: `${c.totalTransactions} עסקאות בדוח ${c.fileName} ממתינות לאישור`, to: `/accounts?tab=credit&importId=${c.id}`, blocking: true })),
    ...bank.needsReview.map(r => ({ key: `bank:${r.id}`, title: `${r.description || "תנועת בנק"} — ${r.resolutionLabel ?? "ללא סיווג"}`, to: `/accounts?tab=reconcile&row=${r.id}`, blocking: r.resolution === null })),
  ];
  if (uncategorized) items.push({ key: "uncategorized", title: `${uncategorized} הוצאות ללא קטגוריה`, to: "/transactions?tab=expenses&uncat=1", blocking: false });
  return items.map(item => ({ ...item, fingerprint: fingerprint(item) }));
}
