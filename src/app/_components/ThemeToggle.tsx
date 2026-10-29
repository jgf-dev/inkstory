"use client";

import { useEffect, useState } from "react";
import { applyTheme, readStoredTheme, type ThemeName } from "@/lib/ui/preferences";

function themeIcon(theme: ThemeName | null): string {
  if (theme === null) return "◐";
  return theme === "dark" ? "☀" : "☾";
}

/**
 * Light/dark theme toggle ("Parchment Desk" ⇄ "Obsidian Desk"). Reads the
 * bootstrap-applied theme after mount (the attribute is set pre-paint by the
 * layout script) and persists the choice per browser.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<ThemeName | null>(null);

  useEffect(() => {
    const stored = readStoredTheme();
    const current =
      stored ??
      (document.documentElement.dataset.theme === "dark" ? "dark" : ("light" as ThemeName));
    setTheme(current);
  }, []);

  function toggle() {
    const next: ThemeName = theme === "dark" ? "light" : "dark";
    setTheme(next);
    applyTheme(next);
  }

  const isDark = theme === "dark";

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={isDark}
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      title={isDark ? "Switch to light theme" : "Switch to dark theme"}
      data-testid="theme-toggle"
      className="flex min-h-11 min-w-11 items-center justify-center rounded-md border border-ink-200 text-lg text-ink-600 hover:bg-ink-100"
    >
      <span aria-hidden="true">{themeIcon(theme)}</span>
    </button>
  );
}
