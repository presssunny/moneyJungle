import { useEffect, useState, type ReactNode } from "react";
import { ThemeContext } from "./themeState";
import type { ThemeName } from "./themes";
import { api } from "../services/api";
import { isLoggedIn } from "../services/gate.service";

const THEME_KEY = "app_theme";


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
      // Deliberately silent (fail-open): the theme already applied from
      // localStorage, so a failed sync changes nothing the user can see. Showing
      // an error for a cosmetic preference would be worse than the failure.
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function setTheme(next: ThemeName) {
    setThemeState(next);
    applyTheme(next);
    if (isLoggedIn()) {
      // Deliberately silent (fail-open): the theme is already applied locally and
      // persisted to localStorage; failing to persist it server-side only means
      // it will not follow to another device. Not worth an error state.
      api.patch("/settings", { theme: next }).catch(() => {});
    }
  }

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}
