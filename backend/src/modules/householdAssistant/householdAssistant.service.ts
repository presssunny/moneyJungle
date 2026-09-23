import { withFinancialTransaction } from "../../config/database";
import type { AssistantAction, HouseholdSnapshot } from "../../types/householdAssistant.types";
import { aiAvailable } from "../ai/ai.service";
import { monthTotals } from "../dashboard/dashboard.service";
import { journeyActions, upcomingCommitments } from "../journey/actions.service";
import { financialStatus } from "../journey/coverage.service";
import { fingerprint } from "../journey/journey.utils";
import { scanDuplicates } from "./duplicateReview.service";
export { scanDuplicates } from "./duplicateReview.service";

export async function householdSnapshot(userId: number): Promise<HouseholdSnapshot> {
  // Reuse the same owner lock as imports so the snapshot cannot straddle a commit.
  return withFinancialTransaction(userId, async () => {
    const state = await financialStatus(userId);
    const [year, month] = state.today.split("-").map(Number);
    const [totals, duplicates, existing] = await Promise.all([
      monthTotals(userId, year, month), scanDuplicates(userId, state.today), journeyActions(userId, state),
    ]);
    const actions: AssistantAction[] = existing.map(a => ({
      id: a.id, title: a.title, reason: a.reason, to: a.to, priority: a.priority,
      kind: a.id.startsWith("goal:") ? "goal" : a.to.startsWith("/budgets") ? "budget" : a.dueDate ? "payment" : "review",
    }));
    if (state.blockers.length && !actions.some(a => a.priority < 15)) actions.unshift({ id: "assistant:coverage", kind: "review", title: "השלמת תמונת הכסף", reason: "חסר מידע לפני שאפשר להעריך כמה כסף פנוי להמשך החודש.", to: "/data", priority: -1 });
    if (duplicates.followUpCount) actions.push({ id: "assistant:duplicate-followup", kind: "duplicate", title: "מעקב אחרי חיובים שסומנו לבירור", reason: "החיובים נשארו בסכומים עד לבירור מול המנפיק. אפשר לפתוח מחדש את ההחלטה לאחר הבירור.", to: "/assistant#duplicate-history", priority: 31 });
    if (duplicates.candidateCount) actions.push({ id: "assistant:duplicates", kind: "duplicate", title: "בדיקת רישומים דומים", reason: "יש רשומות עם אותו שם, יום וסכום. ייתכן שאלו עסקאות שונות — נבדוק מול המקור.", to: "/assistant#duplicates", priority: 30 });
    const ordered = actions.sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
    const upcoming = upcomingCommitments(state).map(({ key, name, date, amount, to }) => ({ key, name, date, amount, to }));
    const snapshot = {
      month: state.today.slice(0, 7), hasActivity: state.hasActivity, totals,
      allowance: { amount: state.allowance.amount, state: state.allowance.state }, blockers: state.blockers,
      actions: ordered.slice(0, 30), actionCount: ordered.length, upcoming, duplicates,
    };
    return { ...snapshot, version: fingerprint([state.dataVersion, snapshot]), generatedAt: new Date().toISOString(), aiAvailable: aiAvailable() };
  });
}
