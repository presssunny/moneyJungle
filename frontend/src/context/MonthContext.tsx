import type { ReactNode } from "react";
import { FiltersProvider, useFilters } from "./FiltersContext";

/**
 * Compatibility shim: the month is now the `range` slice of the global filters
 * (IA §2.2). `useMonth()` is kept so existing pages work unchanged — new code
 * should read `useFilters()` directly.
 */
interface MonthContextValue {
  /** Selected month as "YYYY-MM" */
  monthKey: string;
  year: number;
  month: number;
  setMonthKey: (key: string) => void;
  goToday: () => void;
}

/** @deprecated Use `FiltersProvider`. Kept so older imports do not break. */
export function MonthProvider({ children }: { children: ReactNode }) {
  return <FiltersProvider>{children}</FiltersProvider>;
}

export function useMonth(): MonthContextValue {
  const { monthKey, year, month, setMonthKey, goToday } = useFilters();
  return { monthKey, year, month, setMonthKey, goToday };
}
