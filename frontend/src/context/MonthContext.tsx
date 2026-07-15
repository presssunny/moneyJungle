import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { currentMonthKey } from "../utils/format";

interface MonthContextValue {
  /** Selected month as "YYYY-MM" */
  monthKey: string;
  year: number;
  month: number;
  setMonthKey: (key: string) => void;
  goToday: () => void;
}

const MonthContext = createContext<MonthContextValue | null>(null);

export function MonthProvider({ children }: { children: ReactNode }) {
  const [monthKey, setMonthKey] = useState(currentMonthKey());

  const value = useMemo<MonthContextValue>(() => {
    const [year, month] = monthKey.split("-").map(Number);
    return {
      monthKey,
      year,
      month,
      setMonthKey,
      goToday: () => setMonthKey(currentMonthKey()),
    };
  }, [monthKey]);

  return <MonthContext.Provider value={value}>{children}</MonthContext.Provider>;
}

export function useMonth(): MonthContextValue {
  const ctx = useContext(MonthContext);
  if (!ctx) throw new Error("useMonth must be used inside MonthProvider");
  return ctx;
}
