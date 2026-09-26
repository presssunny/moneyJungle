import type { ActivityPage } from "../types/models";
import { api } from "./api";

export async function listActivity(before?: number): Promise<ActivityPage> {
  const { data } = await api.get("/activity", { params: before ? { before } : {} });
  return data;
}
