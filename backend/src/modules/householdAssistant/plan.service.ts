import { z } from "zod";
import type { AiProvider } from "../ai/ai.types";
import type { AssistantPlan, HouseholdSnapshot } from "../../types/householdAssistant.types";

const selection = z.object({ actionIds: z.array(z.string().max(20)).min(1).max(3) }).strict();

export async function prioritizePlan(userId: number, snapshot: HouseholdSnapshot, provider: AiProvider): Promise<AssistantPlan> {
  const fallback: AssistantPlan = { version: snapshot.version, mode: "rules", actionIds: snapshot.actions.slice(0, 3).map(a => a.id) };
  if (!snapshot.actions.length) return fallback;
  const options = snapshot.actions.map((a, i) => ({ id: `task-${i}`, kind: a.kind, priority: a.priority }));
  try {
    const response = await provider.complete({
      userId, maxTokens: 256, signal: AbortSignal.timeout(15000),
      system: 'Help a household choose up to three next review tasks. Prefer data completeness, then payments, then duplicate checks, budget and goals. Return only JSON {"actionIds":["task-0"]} using supplied IDs. Lower priority numbers are more urgent. Do not calculate, invent facts, propose financial products or perform any action.',
      messages: [{ role: "user", content: JSON.stringify({ incomplete: snapshot.blockers.length > 0, tasks: options }) }],
    });
    if (response.content.length > 2000) return fallback;
    const result = selection.safeParse(JSON.parse(response.content));
    if (!result.success || new Set(result.data.actionIds).size !== result.data.actionIds.length) return fallback;
    const chosen = result.data.actionIds.map(id => options.findIndex(option => option.id === id));
    if (chosen.some(i => i < 0)) return fallback;
    const required = snapshot.actions.filter(a => a.priority <= 25).map(a => a.id);
    const actionIds = [...new Set([...required, ...chosen.map(i => snapshot.actions[i].id), ...fallback.actionIds])].slice(0, 3);
    return { version: snapshot.version, mode: "ai", actionIds };
  } catch {
    return fallback;
  }
}
