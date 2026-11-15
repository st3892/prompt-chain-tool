"use client";

import { useThemePreference, type ThemePreference } from "./theme-provider";

function isThemePreference(value: string): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

export function ThemeSwitcher() {
  const { preference, setPreference } = useThemePreference();

  return (
    <label className="theme-control">
      <span>Theme</span>
      <select
        aria-label="Color theme"
        onChange={(event) => {
          if (isThemePreference(event.target.value)) {
            setPreference(event.target.value);
          }
        }}
        value={preference}
      >
        <option value="light">Light</option>
        <option value="dark">Dark</option>
        <option value="system">System</option>
      </select>
    </label>
  );
}
