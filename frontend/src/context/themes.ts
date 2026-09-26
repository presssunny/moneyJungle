export type ThemeName =
  | "neon-purple"
  | "dark-luxury"
  | "red-cyan"
  | "ocean"
  | "forest"
  | "sunset"
  | "rose-gold"
  | "light";

export const THEMES: Array<{ id: ThemeName; label: string; hint: string; swatches: string[] }> = [
  {
    id: "neon-purple",
    label: "סגול ניאון",
    hint: "סגול חי על רקע כהה",
    swatches: ["#34F5C5", "#E879F9", "#A78BFA", "#150E28"],
  },
  {
    id: "dark-luxury",
    label: "כהה יוקרתי",
    hint: "טורקיז רגוע לערב",
    swatches: ["#F0B451", "#2DD4BF", "#1C2633", "#0D1117"],
  },
  {
    id: "red-cyan",
    label: "אדום / ציאן",
    hint: "אדום מודגש וכחול קריר",
    swatches: ["#3A0F18", "#22D3EE", "#FF2E4D", "#0A0508"],
  },
  {
    id: "ocean",
    label: "עומק האוקיינוס",
    hint: "כחול עמוק ורגוע",
    swatches: ["#38BDF8", "#22D3EE", "#34D399", "#0F1E2E"],
  },
  {
    id: "forest",
    label: "יער לילה",
    hint: "ירוק טבעי ומרגיע",
    swatches: ["#4ADE80", "#A3E635", "#FACC15", "#10201A"],
  },
  {
    id: "sunset",
    label: "שקיעה",
    hint: "כתום חם וורוד",
    swatches: ["#FB923C", "#F472B6", "#34D399", "#241526"],
  },
  {
    id: "rose-gold",
    label: "ורד-זהב",
    hint: "אלגנטי ורך",
    swatches: ["#FB7185", "#E9A86B", "#34D399", "#211A24"],
  },
  {
    id: "light",
    label: "יום בהיר",
    hint: "ערכה בהירה לשעות היום",
    swatches: ["#7C3AED", "#2563EB", "#087b55", "#FFFFFF"],
  },
];
