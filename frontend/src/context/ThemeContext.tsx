import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "../services/api";
import { isLoggedIn } from "../services/gate.service";

export type ThemeName = "neon-purple" | "dark-luxury" | "red-cyan";

export const THEMES: Array<{ id: ThemeName; label: string; hint: string; swatches: string[] }> = [
  {
    id: "neon-purple",
    label: "סגול ניאון",
    hint: "ברירת מחדל · סייברפאנק",
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
    hint: "חדר בקרה פלילי",
    swatches: ["#3A0F18", "#22D3EE", "#FF2E4D", "#0A0508"],
  },
];

const THEME_KEY = "app_theme";

interface ThemeContextValue {
  theme: ThemeName;
  setTheme: (theme: ThemeName) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function applyTheme(theme: ThemeName) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem(THEME_KEY, theme);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeName>(
    () => (localStorage.getItem(THEME_KEY) as ThemeName) || "neon-purple"
  );

  // Sync from server-side settings once per session (server wins over stale localStorage)
  useEffect(() => {
    if (!isLoggedIn()) return;
    api
      .get("/settings")
      .then(({ data }) => {
        if (data?.theme && data.theme !== theme) {
          setThemeState(data.theme);
          applyTheme(data.theme);
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function setTheme(next: ThemeName) {
    setThemeState(next);
    applyTheme(next);
    if (isLoggedIn()) {
      api.patch("/settings", { theme: next }).catch(() => {});
    }
  }

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside ThemeProvider");
  return ctx;
}
