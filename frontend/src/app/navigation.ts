/** Single source of truth for sidebar items + routes. */

export interface NavItem {
  path: string;
  label: string;
  icon: string;
  /** Pages not yet implemented render a ComingSoon placeholder */
  ready: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { path: "/", label: "דשבורד", icon: "📊", ready: true },
  { path: "/incomes", label: "הכנסות", icon: "💰", ready: true },
  { path: "/expenses", label: "הוצאות", icon: "🧾", ready: true },
  { path: "/budgets", label: "תקציב חודשי", icon: "🎯", ready: true },
  { path: "/credit", label: "אשראי", icon: "💳", ready: true },
  { path: "/bank", label: "בנק / חשבונות", icon: "🏦", ready: false },
  { path: "/recurring", label: "תשלומים קבועים", icon: "🔁", ready: false },
  { path: "/subscriptions", label: "מנויים", icon: "📺", ready: false },
  { path: "/loans", label: "הלוואות וחובות", icon: "📉", ready: true },
  { path: "/savings", label: "חיסכון ויעדים", icon: "🐷", ready: false },
  { path: "/calendar", label: "לוח שנה פיננסי", icon: "📅", ready: false },
  { path: "/reports", label: "דוחות", icon: "📈", ready: true },
  { path: "/comparison", label: "השוואת חודשים", icon: "⚖️", ready: false },
  { path: "/alerts", label: "התראות וחריגות", icon: "🚨", ready: false },
  { path: "/categories", label: "קטגוריות וחוקים", icon: "🏷️", ready: true },
  { path: "/payment-methods", label: "אמצעי תשלום", icon: "💼", ready: false },
  { path: "/family", label: "משפחה / משתמשים", icon: "👨‍👩‍👧", ready: false },
  { path: "/imports", label: "ייבוא קבצים", icon: "📂", ready: false },
  { path: "/settings", label: "הגדרות", icon: "⚙️", ready: true },
];
