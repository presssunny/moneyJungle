import type { DashboardCharts, DashboardSummary, RecentLists } from "../types/dashboard.types";
import type { Achievements, DashboardInsights, Upcoming } from "../types/models";
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

export async function getInsights(monthKey: string): Promise<DashboardInsights> {
  const { data } = await api.get("/dashboard/insights", { params: monthParams(monthKey) });
  return data;
}

export async function getAchievements(monthKey: string): Promise<Achievements> {
  const { data } = await api.get("/dashboard/achievements", { params: monthParams(monthKey) });
  return data;
}

export async function getUpcoming(days = 45): Promise<Upcoming> {
  const { data } = await api.get("/dashboard/upcoming", { params: { days } });
  return data;
}
