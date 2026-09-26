import type { CSSProperties } from "react";

// One stroke language for application controls. User-selected category icons
// remain user content and are deliberately not replaced.
const paths: Record<string, string> = {
  home: "m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z",
  transactions: "M4 7h16m-4-4 4 4-4 4M20 17H4m4-4-4 4 4 4",
  target: "M21 12a9 9 0 1 1-9-9m0 4a5 5 0 1 0 5 5m-5 0 9-9m-5 0h5v5",
  bank: "m3 8 9-5 9 5H3Zm2 3v7m5-7v7m4-7v7m5-7v7M3 21h18",
  chart: "M4 3v17h17M8 15l4-5 4 2 5-7",
  settings: "M4 7h16M4 17h16M8 4v6m8 4v6",
  wallet: "M3 7V5a2 2 0 0 1 2-2h13v4M3 7h18v14H5a2 2 0 0 1-2-2V7Zm18 5h-6v5h6",
  card: "M3 5h18v14H3V5Zm0 5h18M7 15h4",
  document: "M6 3h9l4 4v14H6V3Zm8 0v5h5M9 12h7m-7 4h7",
  folder: "M3 6h7l2 3h9v11H3V6Z",
  search: "M20 20l-5-5m2-5a7 7 0 1 1-14 0 7 7 0 0 1 14 0",
  calendar: "M4 5h16v16H4V5Zm0 5h16M8 3v4m8-4v4M8 14h2m4 0h2m-8 3h2",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  edit: "m14 5 5 5M4 20l5-1L21 7l-4-4L5 15l-1 5Z",
  trash: "M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7",
  upload: "M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6",
  leaf: "M20 3C9 2 3 7 5 14s16 6 15-11ZM4 21 15 10",
  info: "M12 11v6m0-10v.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0",
  alert: "m12 3 10 18H2L12 3Zm0 6v5m0 3v.01",
  check: "m5 12 4 4L19 6",
  filter: "M4 6h16M7 12h10m-7 6h4",
  logout: "M10 4H4v16h6m4-12 4 4-4 4m-6-4h12",
  eye: "M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  "eye-off": "M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.2M6.6 6.6C3.7 8.4 2 12 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2",
  lock: "M6 11h12v10H6V11Zm2 0V7a4 4 0 1 1 8 0v4",
  users: "M15 21v-3a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v3m18 0v-3a4 4 0 0 0-3-4M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0m4-3a4 4 0 0 1 0 8",
};
const aliases: Record<string, string> = {
  "🏠":"home", "🔄":"transactions", "🎯":"target", "🏦":"bank", "📈":"chart", "📉":"chart", "📊":"chart", "⚖️":"chart", "🔭":"chart",
  "⚙️":"settings", "💰":"wallet", "💼":"wallet", "💳":"card", "🧾":"document", "📁":"folder", "📂":"folder", "🗂️":"folder",
  "🔍":"search", "🔎":"search", "📅":"calendar", "✏️":"edit", "🗑️":"trash", "🌿":"leaf", "🚨":"alert", "ℹ️":"info", "🔔":"alert", "⚠️":"alert",
  "👨‍👩‍👧":"users", "🐷":"target", "💎":"wallet", "🏆":"target", "🔁":"transactions", "🔗":"transactions", "⋯":"more",
};
export function Icon({ name, size = 20, style }: { name: string; size?: number; style?: CSSProperties }) {
  return <svg className="ui-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" style={style}><path d={paths[aliases[name] ?? name] ?? paths.document}/></svg>;
}
