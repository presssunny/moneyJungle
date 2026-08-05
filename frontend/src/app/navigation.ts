/**
 * Single source of truth for the primary navigation + route titles.
 *
 * FIVE primary destinations plus a separate "manage" hub, replacing a flat list
 * of 19 links. Sub-screens live in tabbed hubs, reached via ?tab=… on the route.
 */

export interface NavItem {
  path: string;
  label: string;
  icon: string;
}

/** Daily-use destinations shown in the sidebar and the mobile bottom bar. */
export const PRIMARY_NAV: NavItem[] = [
  { path: "/", label: "בית", icon: "🏠" },
  { path: "/transactions", label: "תנועות", icon: "🔄" },
  { path: "/budgets", label: "תקציב", icon: "🎯" },
  { path: "/accounts", label: "חשבונות וחובות", icon: "🏦" },
  { path: "/reports", label: "דוחות", icon: "📈" },
];

/** Setup / occasional screens — deliberately kept out of the primary rail. */
export const MANAGE_NAV: NavItem = { path: "/manage", label: "הגדרות וניהול", icon: "⚙️" };

/** Titles for the header, covering hubs, primary routes AND legacy standalone routes. */
const ROUTE_TITLES: Record<string, NavItem> = {
  "/": PRIMARY_NAV[0],
  "/transactions": PRIMARY_NAV[1],
  "/budgets": PRIMARY_NAV[2],
  "/accounts": PRIMARY_NAV[3],
  "/reports": PRIMARY_NAV[4],
  "/manage": MANAGE_NAV,
  // legacy standalone routes (still reachable via deep links / bookmarks)
  "/incomes": { path: "/incomes", label: "הכנסות", icon: "💰" },
  "/expenses": { path: "/expenses", label: "הוצאות", icon: "🧾" },
  "/credit": { path: "/credit", label: "אשראי", icon: "💳" },
  "/bank": { path: "/bank", label: "בנק / חשבונות", icon: "🏦" },
  "/recurring": { path: "/recurring", label: "תשלומים קבועים", icon: "🔁" },
  "/subscriptions": { path: "/subscriptions", label: "מנויים", icon: "📺" },
  "/loans": { path: "/loans", label: "הלוואות וחובות", icon: "📉" },
  "/documents": { path: "/documents", label: "מרכז המסמכים", icon: "📁" },
  "/savings": { path: "/savings", label: "חיסכון ויעדים", icon: "🐷" },
  "/calendar": { path: "/calendar", label: "לוח שנה פיננסי", icon: "📅" },
  "/comparison": { path: "/comparison", label: "השוואת חודשים", icon: "⚖️" },
  "/alerts": { path: "/alerts", label: "התראות וחריגות", icon: "🚨" },
  "/categories": { path: "/categories", label: "קטגוריות וחוקים", icon: "🏷️" },
  "/payment-methods": { path: "/payment-methods", label: "אמצעי תשלום", icon: "💼" },
  "/family": { path: "/family", label: "משפחה / משתמשים", icon: "👨‍👩‍👧" },
  "/imports": { path: "/imports", label: "ייבוא קבצים", icon: "📂" },
  "/settings": { path: "/settings", label: "הגדרות", icon: "⚙️" },
  "/onboarding": { path: "/onboarding", label: "ברוכה הבאה", icon: "👋" },
};

/** Resolve the header title for a pathname (longest-prefix match; "/" is exact). */
export function routeTitle(pathname: string): NavItem | undefined {
  if (ROUTE_TITLES[pathname]) return ROUTE_TITLES[pathname];
  const match = Object.keys(ROUTE_TITLES)
    .filter((p) => p !== "/" && pathname.startsWith(p))
    .sort((a, b) => b.length - a.length)[0];
  return match ? ROUTE_TITLES[match] : ROUTE_TITLES["/"];
}
