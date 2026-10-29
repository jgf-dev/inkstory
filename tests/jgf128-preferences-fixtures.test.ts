// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  applyProseFont,
  applyTheme,
  persistWorkspaceMode,
  PREFERENCES_BOOTSTRAP_SCRIPT,
  PROSE_FONT_STORAGE_KEY,
  readProseFont,
  readStoredTheme,
  readWorkspaceMode,
  THEME_STORAGE_KEY,
  WORKSPACE_MODE_STORAGE_KEY,
} from "../src/lib/ui/preferences";
import { nextFixtureBeat, STAGE_FIXTURE_BEATS } from "../src/lib/stage/fixtures";

describe("UI preferences (JGF-128)", () => {
  const originalLocalStorage = window.localStorage;

  afterEach(() => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      writable: true,
      value: originalLocalStorage,
    });
    originalLocalStorage.clear();
    delete document.documentElement.dataset.theme;
    delete document.documentElement.dataset.proseFont;
    vi.restoreAllMocks();
  });

  it("reads and applies theme, prose font, and workspace mode", () => {
    expect(readStoredTheme()).toBeNull();
    expect(readProseFont()).toBe("serif");
    expect(readWorkspaceMode()).toBe("architect");

    applyTheme("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(readStoredTheme()).toBe("dark");

    applyTheme("light");
    expect(readStoredTheme()).toBe("light");

    applyProseFont("sans");
    expect(window.localStorage.getItem(PROSE_FONT_STORAGE_KEY)).toBe("sans");
    expect(document.documentElement.dataset.proseFont).toBe("sans");
    expect(readProseFont()).toBe("sans");

    applyProseFont("serif");
    expect(readProseFont()).toBe("serif");

    persistWorkspaceMode("writer");
    expect(window.localStorage.getItem(WORKSPACE_MODE_STORAGE_KEY)).toBe("writer");
    expect(readWorkspaceMode()).toBe("writer");
    persistWorkspaceMode("stage");
    expect(readWorkspaceMode()).toBe("stage");
    persistWorkspaceMode("architect");
    expect(readWorkspaceMode()).toBe("architect");
  });

  it("ignores invalid stored values and survives localStorage throwing", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "neon");
    window.localStorage.setItem(WORKSPACE_MODE_STORAGE_KEY, "chaos");
    expect(readStoredTheme()).toBeNull();
    expect(readWorkspaceMode()).toBe("architect");

    const boom = new Error("storage blocked");
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw boom;
    });
    expect(readStoredTheme()).toBeNull();
    expect(readProseFont()).toBe("serif");
    expect(readWorkspaceMode()).toBe("architect");

    vi.restoreAllMocks();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw boom;
      },
    });
    expect(readStoredTheme()).toBeNull();
    applyTheme("dark");
    applyProseFont("sans");
    persistWorkspaceMode("writer");
  });

  it("embeds the storage keys in the pre-paint bootstrap script", () => {
    expect(PREFERENCES_BOOTSTRAP_SCRIPT).toContain(THEME_STORAGE_KEY);
    expect(PREFERENCES_BOOTSTRAP_SCRIPT).toContain(PROSE_FONT_STORAGE_KEY);
  });
});

describe("stage fixtures (JGF-128)", () => {
  it("cycles fixture beats in order and wraps", () => {
    expect(nextFixtureBeat(null).id).toBe(STAGE_FIXTURE_BEATS[0].id);
    expect(nextFixtureBeat("unknown").id).toBe(STAGE_FIXTURE_BEATS[0].id);
    expect(nextFixtureBeat(STAGE_FIXTURE_BEATS[0].id).id).toBe(STAGE_FIXTURE_BEATS[1].id);
    expect(nextFixtureBeat(STAGE_FIXTURE_BEATS.at(-1)!.id).id).toBe(STAGE_FIXTURE_BEATS[0].id);
  });
});
