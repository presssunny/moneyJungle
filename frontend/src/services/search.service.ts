import { api } from "./api";

export interface SearchItem {
  key: string;
  label: string;
  detail: string | null;
  amount: number | null;
  date: string | null;
  to: string;
}

export interface SearchGroup {
  kind: string;
  label: string;
  items: SearchItem[];
}

export async function searchRecords(q: string, signal?: AbortSignal): Promise<SearchGroup[]> {
  const { data } = await api.get<{ groups: SearchGroup[] }>("/search", { params: { q }, signal });
  return data.groups;
}
