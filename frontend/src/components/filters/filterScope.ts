/**
 * Which global filters each tab actually consumes (IA §2.4).
 *
 * A filter a tab does not consume is **hidden**, never shown greyed-out — a
 * disabled control just raises the question "why is this blocked?".
 */
export interface FilterScope {
  range: boolean;
  account: boolean;
  category: boolean;
  /** The tab reads a whole month and cannot honour a custom date range. */
  monthOnly: boolean;
}

const NONE: FilterScope = { range: false, account: false, category: false, monthOnly: false };

/** Resolve the scope for a route + hub sub-tab (`?tab=`). */
export function filterScope(pathname: string, tab: string | null): FilterScope {
  switch (pathname) {
    case "/":
      return { range: true, account: false, category: false, monthOnly: false };
    case "/transactions":
    case "/expenses":
    case "/incomes":
      return { range: true, account: true, category: true, monthOnly: false };
    case "/budgets":
      return { range: true, account: false, category: true, monthOnly: true };
    case "/reports":
    case "/comparison":
      return { range: true, account: false, category: true, monthOnly: false };
    case "/accounts":
      // Savings goals have no time dimension — a month picker there is noise.
      if (tab === "savings") return NONE;
      if (tab === "loans") return { range: true, account: false, category: false, monthOnly: false };
      return { range: true, account: true, category: true, monthOnly: false };
    case "/credit":
    case "/bank":
      return { range: true, account: true, category: true, monthOnly: false };
    case "/savings":
      return NONE;
    default:
      // Setup screens (/manage, /categories, …) are not month-scoped.
      return NONE;
  }
}
