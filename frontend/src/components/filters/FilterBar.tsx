import { useLocation, useSearchParams } from "react-router-dom";
import { useFilters } from "../../context/FiltersContext";
import { currentMonthKey, formatMonthKey } from "../../utils/format";
import { MonthSelector } from "../header/MonthSelector";
import { filterScope } from "./filterScope";

/**
 * Sticky strip of global filters, directly under the header and above the tab
 * content (IA §2.3). Moving the month picker out of the header gives every tab
 * the same "what am I looking at" line in the same place, and leaves the header
 * to the page title alone.
 *
 * Stage ב' renders the **range only** — account and category pickers wait for
 * the API work in IA §9.2 (no endpoint accepts accountId, and a category filter
 * that only works on one tab would be a lie). The strip wraps instead of
 * scrolling horizontally on mobile (§8.2).
 */
export function FilterBar() {
  const location = useLocation();
  const [params] = useSearchParams();
  const { monthKey, goToday, activeCount } = useFilters();
  const scope = filterScope(location.pathname, params.get("tab"));

  if (!scope.range) return null;

  return (
    <div className="filter-strip" role="search" aria-label="מסנני תצוגה">
      <span className="filter-strip-label">תצוגה:</span>
      <MonthSelector />

      {scope.monthOnly && monthKey !== currentMonthKey() && (
        <span className="filter-strip-note">התקציב מוגדר לפי חודש — מוצג {formatMonthKey(monthKey)}.</span>
      )}

      {activeCount > 0 && (
        <button type="button" className="filter-chip" onClick={goToday}>
          {formatMonthKey(monthKey)} <span aria-hidden>✕</span>
          <span className="sr-only">ניקוי — חזרה לחודש הנוכחי</span>
        </button>
      )}
    </div>
  );
}
