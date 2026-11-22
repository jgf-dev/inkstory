/**
 * Author-facing UI preferences (JGF-128): theme, prose font, and workspace
 * operating mode. Persisted in localStorage and mirrored onto
 * `<html data-theme|data-prose-font>` so CSS variables swap without a
 * reload. The inline bootstrap in `app/layout.tsx` applies the stored values
 * before first paint; these helpers are the client-side write path.
 */

export type ThemeName = "light" | "dark";
export type ProseFont = "serif" | "sans";
export type WorkspaceMode = "writer" | "stage" | "architect";

export const THEME_STORAGE_KEY = "inkstory.theme";
export const PROSE_FONT_STORAGE_KEY = "inkstory.prose-font";
export const WORKSPACE_MODE_STORAGE_KEY = "inkstory.mode";

function safeLocalStorage(): Storage | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readStoredTheme(): ThemeName | null {
  const value = safeLocalStorage()?.getItem(THEME_STORAGE_KEY);
  return value === "light" || value === "dark" ? value : null;
}

export function readProseFont(): ProseFont {
  return safeLocalStorage()?.getItem(PROSE_FONT_STORAGE_KEY) === "sans" ? "sans" : "serif";
}

export function readWorkspaceMode(): WorkspaceMode {
  const value = safeLocalStorage()?.getItem(WORKSPACE_MODE_STORAGE_KEY);
  return value === "writer" || value === "stage" || value === "architect" ? value : "architect";
}

/** Applies the theme to `<html data-theme>` and persists it. */
export function applyTheme(theme: ThemeName): void {
  safeLocalStorage()?.setItem(THEME_STORAGE_KEY, theme);
  if (typeof document !== "undefined") {
    document.documentElement.dataset.theme = theme;
  }
}

/** Applies the prose font choice to `<html data-prose-font>` and persists it. */
export function applyProseFont(font: ProseFont): void {
  safeLocalStorage()?.setItem(PROSE_FONT_STORAGE_KEY, font);
  if (typeof document !== "undefined") {
    document.documentElement.dataset.proseFont = font;
  }
}

export function persistWorkspaceMode(mode: WorkspaceMode): void {
  safeLocalStorage()?.setItem(WORKSPACE_MODE_STORAGE_KEY, mode);
}

/**
 * Inline bootstrap script (runs before first paint to avoid a theme flash).
 * Keep in sync with the storage keys above.
 */
export const PREFERENCES_BOOTSTRAP_SCRIPT = `(function(){try{var t=localStorage.getItem("${THEME_STORAGE_KEY}");if(t!=="light"&&t!=="dark"){t=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";}document.documentElement.dataset.theme=t;var p=localStorage.getItem("${PROSE_FONT_STORAGE_KEY}");document.documentElement.dataset.proseFont=p==="sans"?"sans":"serif";}catch(e){document.documentElement.dataset.theme="light";}})();`;
