import { api } from "./api";
import type { AssistantPlan, HouseholdSnapshot, DuplicateCandidate, DuplicateReviewInput, DuplicateReviewResult, DuplicateReviewView } from "../types/models";

export async function getHouseholdSnapshot(): Promise<HouseholdSnapshot> {
  return (await api.get<HouseholdSnapshot>("/household-assistant")).data;
}

export async function requestHouseholdPlan(version: string): Promise<AssistantPlan> {
  return (await api.post<AssistantPlan>("/household-assistant/plan", { version, consent: true })).data;
}

export async function getDuplicate(id: string): Promise<DuplicateCandidate> {
  return (await api.get<DuplicateCandidate>(`/household-assistant/duplicates/${encodeURIComponent(id)}`)).data;
}
export interface DuplicateHistory { items: DuplicateReviewView[]; nextCursor: string | null }
export async function getDuplicateHistory(cursor?: string, followUp = false): Promise<DuplicateHistory> {
  return (await api.get<DuplicateHistory>("/household-assistant/duplicate-reviews", { params: { cursor, followUp: String(followUp) } })).data;
}
export async function reviewDuplicate(input: DuplicateReviewInput): Promise<DuplicateReviewResult> {
  return (await api.post<DuplicateReviewResult>("/household-assistant/duplicate-reviews", input)).data;
}
export async function undoDuplicate(review: DuplicateReviewView): Promise<DuplicateReviewResult> {
  return (await api.post<DuplicateReviewResult>(`/household-assistant/duplicate-reviews/${review.id}/undo`, { version: review.version, confirmed: true })).data;
}
