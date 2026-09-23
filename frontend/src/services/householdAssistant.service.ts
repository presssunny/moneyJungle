import { api } from "./api";
import type { AssistantPlan, HouseholdSnapshot } from "../types/models";

export async function getHouseholdSnapshot(): Promise<HouseholdSnapshot> {
  return (await api.get<HouseholdSnapshot>("/household-assistant")).data;
}

export async function requestHouseholdPlan(version: string): Promise<AssistantPlan> {
  return (await api.post<AssistantPlan>("/household-assistant/plan", { version, consent: true })).data;
}
