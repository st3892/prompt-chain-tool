"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";

export type ThemePreference = "light" | "dark" | "system";

type ThemeContextValue = {
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function getThemePreference(): ThemePreference {
  const preference = document.documentElement.dataset.themePreference;
  return preference === "light" || preference === "dark" ? preference : "system";
}

function subscribeToThemePreference(onChange: () => void) {
  window.addEventListener("theme-preference-change", onChange);
  return () => window.removeEventListener("theme-preference-change", onChange);
}

function getServerThemePreference(): ThemePreference {
  return "system";
}

function applyTheme(preference: ThemePreference) {
  const isDark =
    preference === "dark" ||
    (preference === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);

  document.documentElement.dataset.themePreference = preference;
  document.documentElement.dataset.theme = isDark ? "dark" : "light";
  window.dispatchEvent(new Event("theme-preference-change"));
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const preference = useSyncExternalStore(
    subscribeToThemePreference,
    getThemePreference,
    getServerThemePreference,
  );

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const updateSystemTheme = () => {
      if (preference === "system") applyTheme("system");
    };

    mediaQuery.addEventListener("change", updateSystemTheme);
    return () => mediaQuery.removeEventListener("change", updateSystemTheme);
  }, [preference]);

  const setPreference = useCallback((nextPreference: ThemePreference) => {
    applyTheme(nextPreference);
    try {
      window.localStorage.setItem("prompt-chain-theme", nextPreference);
    } catch {
      // The selected theme remains active until the page is closed.
    }
  }, []);

  const value = useMemo(
    () => ({ preference, setPreference }),
    [preference, setPreference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useThemePreference() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useThemePreference must be used within ThemeProvider.");
  }
  return context;
}

export const themeBootstrapScript = `try {
  var preference = localStorage.getItem("prompt-chain-theme");
  if (preference !== "light" && preference !== "dark") preference = "system";
  var dark = preference === "dark" ||
    (preference === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.themePreference = preference;
  document.documentElement.dataset.theme = dark ? "dark" : "light";
} catch {
  var dark = matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.dataset.themePreference = "system";
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}`;
