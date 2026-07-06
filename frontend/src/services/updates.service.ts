import type { TickerItem } from "../types/dashboard.types";
import { api } from "./api";

export async function getTicker(): Promise<TickerItem[]> {
  const { data } = await api.get("/updates/ticker");
  return data;
}
