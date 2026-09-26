import { useEffect, useState } from "react";
import { useTransactionFilters } from "./useTransactionFilters";

const FILTER_KEYS = { expenses: ["category", "uncat", "recurring", "from", "to"], incomes: ["type", "from", "to"] } as const;

/**
 * The URL filters as server query params, with the free-text search debounced so
 * typing does not send a request per keystroke. A changed filter starts again at
 * page 1 without an effect: the page belongs to the filter set it was chosen for.
 */
export function useLedgerQuery(kind: "expenses" | "incomes") {
  const { params, clear } = useTransactionFilters();
  const search = params.get("q") ?? "";
  const [debounced, setDebounced] = useState(search);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(timer);
  }, [search]);
  const filters: Record<string, string> = {};
  for (const key of FILTER_KEYS[kind]) { const value = params.get(key); if (value) filters[key] = value; }
  if (debounced.trim()) filters.q = debounced.trim();
  const filterKey = JSON.stringify(filters);
  const [paging, setPaging] = useState({ filterKey, page: 1 });
  const page = paging.filterKey === filterKey ? paging.page : 1;
  return {
    filters, filterKey, page,
    setPage: (next: number) => setPaging({ filterKey, page: next }),
    active: Object.keys(filters).length > 0 || search.trim() !== "",
    clear,
  };
}
