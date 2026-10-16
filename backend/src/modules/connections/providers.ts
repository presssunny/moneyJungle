import type { ConnectionKind, ConnectionProvider } from "../../types/connections.types";

export interface ProviderField {
  key: "username" | "password" | "id" | "card6Digits";
  label: string;
  secret: boolean;
}

export interface ProviderInfo {
  id: ConnectionProvider;
  kind: ConnectionKind;
  name: string;
  fields: ProviderField[];
  /** Shown while the login waits — phrased as "if", the bank may not ask at all. */
  approvalHint: string | null;
}

const password: ProviderField = { key: "password", label: "סיסמה", secret: true };
const username: ProviderField = { key: "username", label: "שם משתמש", secret: false };

// Field keys mirror israeli-bank-scrapers' SCRAPERS[company].loginFields.
export const PROVIDERS: Record<ConnectionProvider, ProviderInfo> = {
  beinleumi: {
    id: "beinleumi", kind: "bank", name: "הבנק הבינלאומי", fields: [username, password],
    approvalHint: "אם הבנק שלח בקשת אישור לאפליקציה בטלפון — יש לאשר אותה עכשיו. ממתינים עד 3 דקות.",
  },
  visaCal: { id: "visaCal", kind: "card", name: "כאל", fields: [username, password], approvalHint: null },
  max: { id: "max", kind: "card", name: "מקס", fields: [username, password], approvalHint: null },
  isracard: {
    id: "isracard", kind: "card", name: "ישראכרט",
    fields: [{ key: "id", label: "תעודת זהות", secret: false }, { key: "card6Digits", label: "6 ספרות אחרונות של הכרטיס", secret: false }, password],
    approvalHint: null,
  },
};

export function providerInfo(id: string): ProviderInfo | null {
  return Object.prototype.hasOwnProperty.call(PROVIDERS, id) ? PROVIDERS[id as ConnectionProvider] : null;
}
