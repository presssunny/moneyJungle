import { prisma } from "../../config/database";
import { collectAttentionCandidates, mergeAttention } from "../dashboard/attention.service";
import type { financialStatus } from "./coverage.service";
import { nextDate } from "./journey.utils";

export interface JourneyAction {
  id: string;
  topic: string;
  title: string;
  reason: string;
  to: string;
  priority: number;
  dueDate?: string;
}

export function rankActions(candidates: JourneyAction[]): JourneyAction[] {
  const topics = new Map<string, JourneyAction>();
  for (const candidate of candidates) {
    const current = topics.get(candidate.topic);
    if (!current || candidate.priority < current.priority) topics.set(candidate.topic, candidate);
  }
  return [...topics.values()].sort((a,b) => a.priority-b.priority || (a.dueDate??"9999").localeCompare(b.dueDate??"9999") || a.id.localeCompare(b.id));
}

export function upcomingCommitments(state: Awaited<ReturnType<typeof financialStatus>>) {
  return state.events.filter(e => e.date < nextDate(state.today, 7) && !["paid", "duplicate"].includes(e.decision ?? ""));
}

export async function journeyActions(userId: number, state: Awaited<ReturnType<typeof financialStatus>>) {
  const [year,month] = state.today.split("-").map(Number);
  const [attention,goals] = await Promise.all([
    collectAttentionCandidates(userId,year,month),
    prisma.savingsGoal.findMany({where:{userId},orderBy:[{targetDate:"asc"},{id:"asc"}]}),
  ]);
  const candidates: JourneyAction[] = state.issues.map(issue => ({
    id:issue.key, topic:issue.topic ?? issue.key, title:issue.title, to:issue.to,
    reason:issue.blocking ? "המידע הזה חוסם תמונה פיננסית שניתן לבדוק" : "השלמת הפירוט תקל על מעקב ההוצאות", priority:issue.blocking ? 0 : 50,
  }));
  if (state.blockers.length) candidates.push({id:"coverage",topic:"coverage",title:"בדיקת המקורות וההתחייבויות",reason:state.blockers[0],to:"/data",priority:10});
  for (const event of upcomingCommitments(state)) {
    if (event.amount !== null && event.amount <= 0) continue;
    candidates.push({id:event.key,topic:event.key,dueDate:event.date,title:`${event.date < state.today ? "חוב פתוח" : "חיוב קרוב"}: ${event.name}`,reason:event.date < state.today ? `מועד התשלום ${event.date} עבר ולא נמצא אישור סילוק` : `יש לוודא כיסוי לחיוב בתאריך ${event.date}`,to:"/commitments",priority:event.date < state.today ? 15 : 20});
  }
  const detailedBank = state.issues.some(i=>i.key.startsWith("bank:"));
  const detailedCredit = state.issues.some(i=>i.key.startsWith("credit:"));
  for (const item of mergeAttention(attention)) {
    const candidate = attention.find(a=>a.id===item.id)!;
    if ((detailedBank && ["bank-unresolved","bank-review","bank-coarse"].includes(candidate.topic)) || (detailedCredit && candidate.topic==="credit-pending") || ["reminder","upcoming"].includes(candidate.source)) continue;
    candidates.push({id:item.id,topic:candidate.topic,title:item.text,reason:"לפי התנועות והתקציב הרשומים בחודש הנוכחי",to:item.to,priority:item.tone==="critical" ? 25 : 40});
  }
  const goal = goals.filter(g=>Number(g.currentAmount)<Number(g.targetAmount)).sort((a,b)=>(a.targetDate?.getTime()??Infinity)-(b.targetDate?.getTime()??Infinity)||Number(b.monthlyTarget??0)-Number(a.monthlyTarget??0))[0];
  if(goal) candidates.push({id:`goal:${goal.id}`,topic:`goal:${goal.id}`,title:`בדיקת ההתקדמות ביעד: ${goal.goalName}`,reason:goal.targetDate?`זהו היעד הפתוח הקרוב ביותר, לתאריך ${goal.targetDate.toISOString().slice(0,10)}`:"יעד פתוח עם סכום שנותר להשלמה",to:"/accounts?tab=savings",priority:60});
  return rankActions(candidates);
}
