import { useLocation, useSearchParams } from "react-router-dom";
import { useFilters } from "../../context/FiltersContext";
import { currentMonthKey, formatMonthKey } from "../../utils/format";
import { MonthSelector } from "../header/MonthSelector";
import { filterScope } from "./filterScope";

/**
 * Sticky strip of global filters under the header (IA §2.3), so every tab has its
 * "what am I looking at" line in the same place. Range only for now — account and
 * category pickers wait for the API work in §9.2. Wraps on mobile (§8.2).
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
