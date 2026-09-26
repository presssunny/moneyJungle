import { createContext, useContext } from "react";

export type RangeMode = "month" | "custom";

export interface GlobalFilters {
  range: { mode: RangeMode; monthKey: string; from: string; to: string };
  accountId: number | null;
  categoryId: number | null;
}

export interface FiltersContextValue extends GlobalFilters {
  /** Selected month as "YYYY-MM" (kept for the legacy useMonth() API). */
  monthKey: string;
  year: number;
  month: number;
  setMonthKey: (key: string) => void;
  goToday: () => void;
  setAccountId: (id: number | null) => void;
  setCategoryId: (id: number | null) => void;
  clearAll: () => void;
  /** How many filters differ from the default — drives the mobile "מסננים (2)" badge. */
  activeCount: number;
}

export const FiltersContext = createContext<FiltersContextValue | null>(null);

export function useFilters(): FiltersContextValue {
  const ctx = useContext(FiltersContext);
  if (!ctx) throw new Error("useFilters must be used inside FiltersProvider");
  return ctx;
}
