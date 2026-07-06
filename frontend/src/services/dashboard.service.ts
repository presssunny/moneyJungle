import type { DashboardCharts, DashboardSummary, RecentLists } from "../types/dashboard.types";
import { api } from "./api";

function monthParams(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  return { year, month };
}

export async function getSummary(monthKey: string): Promise<DashboardSummary> {
  const { data } = await api.get("/dashboard/summary", { params: monthParams(monthKey) });
  return data;
}

export async function getCharts(monthKey: string): Promise<DashboardCharts> {
  const { data } = await api.get("/dashboard/charts", { params: monthParams(monthKey) });
  return data;
}

export async function getRecent(): Promise<RecentLists> {
  const { data } = await api.get("/dashboard/recent-transactions");
  return data;
}
