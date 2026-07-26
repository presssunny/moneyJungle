import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { currentMonthKey } from "../utils/format";

/**
 * Global filters shared by every tab (IA §2).
 *
 * Stage ב' ships the **range only, in month mode**. `custom` range, account and
 * category filters need API support that does not exist yet (IA §9.2: every
 * endpoint takes year+month, none takes from/to or accountId), so the shape is
 * declared here — the UI simply does not offer the controls yet. Declaring them
 * now keeps the storage/URL contract stable when 9.2 lands.
 */
export type RangeMode = "month" | "custom";

export interface GlobalFilters {
  range: { mode: RangeMode; monthKey: string; from: string; to: string };
  accountId: number | null;
  categoryId: number | null;
}

interface FiltersContextValue extends GlobalFilters {
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

const FiltersContext = createContext<FiltersContextValue | null>(null);

const STORAGE_KEY = "mj_filters";

interface StoredFilters {
  monthKey: string;
  accountId: number | null;
  categoryId: number | null;
}

function lastDayOfMonth(monthKey: string): string {
  const [year, month] = monthKey.split("-").map(Number);
  return `${monthKey}-${String(new Date(year, month, 0).getDate()).padStart(2, "0")}`;
}

function isMonthKey(value: string | null): value is string {
  return value !== null && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

function readNumber(value: string | null): number | null {
  if (value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** URL wins over sessionStorage (a shared link must show what the sender saw). */
function initialFilters(search: URLSearchParams): StoredFilters {
  let stored: Partial<StoredFilters> = {};
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) stored = JSON.parse(raw) as Partial<StoredFilters>;
  } catch {
    // Corrupt or unavailable storage must never block the app — fall back to defaults.
  }
  const fromUrl = search.get("month");
  return {
    monthKey: isMonthKey(fromUrl) ? fromUrl : isMonthKey(stored.monthKey ?? null) ? stored.monthKey! : currentMonthKey(),
    accountId: readNumber(search.get("account")) ?? stored.accountId ?? null,
    categoryId: readNumber(search.get("cat")) ?? stored.categoryId ?? null,
  };
}

export function FiltersProvider({ children }: { children: ReactNode }) {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const [filters, setFilters] = useState<StoredFilters>(() => initialFilters(params));

  const { monthKey, accountId, categoryId } = filters;

  // Persist for the session and mirror to the URL, alongside TabbedHub's ?tab=
  // (both use the functional updater, so neither clobbers the other). Runs on
  // navigation too, so the filters survive moving between tabs.
  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(filters));
    } catch {
      // Private-mode storage failures are not worth interrupting the user for.
    }
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("month", monthKey);
        if (accountId === null) next.delete("account");
        else next.set("account", String(accountId));
        if (categoryId === null) next.delete("cat");
        else next.set("cat", String(categoryId));
        return next;
      },
      { replace: true }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthKey, accountId, categoryId, location.pathname]);

  const setMonthKey = useCallback((key: string) => setFilters((f) => ({ ...f, monthKey: key })), []);
  const goToday = useCallback(() => setFilters((f) => ({ ...f, monthKey: currentMonthKey() })), []);
  const setAccountId = useCallback((id: number | null) => setFilters((f) => ({ ...f, accountId: id })), []);
  const setCategoryId = useCallback((id: number | null) => setFilters((f) => ({ ...f, categoryId: id })), []);
  const clearAll = useCallback(
    () => setFilters({ monthKey: currentMonthKey(), accountId: null, categoryId: null }),
    []
  );

  const value = useMemo<FiltersContextValue>(() => {
    const [year, month] = monthKey.split("-").map(Number);
    return {
      range: { mode: "month", monthKey, from: `${monthKey}-01`, to: lastDayOfMonth(monthKey) },
      accountId,
      categoryId,
      monthKey,
      year,
      month,
      setMonthKey,
      goToday,
      setAccountId,
      setCategoryId,
      clearAll,
      activeCount:
        (monthKey === currentMonthKey() ? 0 : 1) + (accountId === null ? 0 : 1) + (categoryId === null ? 0 : 1),
    };
  }, [monthKey, accountId, categoryId, setMonthKey, goToday, setAccountId, setCategoryId, clearAll]);

  return <FiltersContext.Provider value={value}>{children}</FiltersContext.Provider>;
}

export function useFilters(): FiltersContextValue {
  const ctx = useContext(FiltersContext);
  if (!ctx) throw new Error("useFilters must be used inside FiltersProvider");
  return ctx;
}
