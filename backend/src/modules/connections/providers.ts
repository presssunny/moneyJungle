import type { ConnectionKind, ConnectionProvider, LoginMethod } from "../../types/connections.types";

export interface LoginMethodInfo {
  id: LoginMethod;
  label: string;
  description: string;
  /** supported: the library's own login. experimental: built, but not yet tried against the real bank. */
  status: "supported" | "experimental";
}

export interface ProviderInfo {
  id: ConnectionProvider;
  kind: ConnectionKind;
  name: string;
  /** Offered for new connections. Empty: no window of its own can be opened yet — see unavailableReason. */
  loginMethods: LoginMethodInfo[];
  /** The bank's own address the official window opens; the page shows it so she can check the window. */
  officialLoginUrl: string | null;
  unavailableReason: string | null;
  /** Shown while the login waits — phrased as "if", the bank may not ask at all. */
  approvalHint: string | null;
}

// Product decision 2026-10-20: credentials are no longer typed into our page. "password" stays only for
// connections made before it, which still sync; a new connection opens the provider's own window.
const officialWindow: LoginMethodInfo = {
  id: "official_window", label: "כניסה בחלון הרשמי של הבנק", status: "experimental",
  description: "ייפתח חלון כרום נפרד עם האתר האמיתי של הבנק. שם נכנסים, בדרך שהבנק מציע. שום פרט כניסה לא עובר דרכנו ולא נשמר.",
};
// The card scrapers (6.12.2) each log in their own way — Cal reads a token at login, Max waits seconds
// for a redirect, Isracard posts without a page — so a window she signs in to by hand is unproven there.
const NO_CARD_WINDOW = "חברת האשראי עוד לא נתמכת בכניסה בחלון נפרד. בינתיים אפשר להמשיך להעלות את קובץ העסקאות מהאתר שלה.";

export const PROVIDERS: Record<ConnectionProvider, ProviderInfo> = {
  beinleumi: {
    id: "beinleumi", kind: "bank", name: "הבנק הבינלאומי", loginMethods: [officialWindow],
    officialLoginUrl: "https://www.fibi.co.il/private/", unavailableReason: null,
    approvalHint: "אם הגיעה לטלפון בקשת אישור מאפליקציית הבנק — אשרי אותה עכשיו. הזמן שנותר מוצג למטה.",
  },
  visaCal: { id: "visaCal", kind: "card", name: "כאל", loginMethods: [], officialLoginUrl: null, unavailableReason: NO_CARD_WINDOW, approvalHint: null },
  max: { id: "max", kind: "card", name: "מקס", loginMethods: [], officialLoginUrl: null, unavailableReason: NO_CARD_WINDOW, approvalHint: null },
  isracard: {
    id: "isracard", kind: "card", name: "ישראכרט",
    loginMethods: [], officialLoginUrl: null, unavailableReason: NO_CARD_WINDOW,
    approvalHint: null,
  },
};

export function providerInfo(id: string): ProviderInfo | null {
  return Object.prototype.hasOwnProperty.call(PROVIDERS, id) ? PROVIDERS[id as ConnectionProvider] : null;
}
