import { vi, type Mock } from "vite-plus/test";

/** Scene row returned by the mocked getSceneForEditor in Craft route tests. */
export function craftSceneRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "scene",
    novelId: "novel",
    novelTitle: "The Salt Road",
    chapterTitle: "Harbor",
    title: "Docks at Dawn",
    content: "Mara walked to the pier. The boat was late.",
    summary: "Mara waits.",
    excludeFromAi: false,
    pov: "THIRD_LIMITED",
    tense: "PAST",
    ...overrides,
  };
}

/** Signed-in owner, platform gateway configured, empty Codex, one scene. */
export function primeCraftRoute(
  mocks: { getUser: Mock; assemble: Mock; getScene: Mock },
  scene: Record<string, unknown> = {},
) {
  vi.stubEnv("AI_GATEWAY_API_KEY", "platform-key");
  vi.stubEnv("AI_MODEL", "");
  mocks.getUser.mockResolvedValue({ data: { user: { id: "owner" } } });
  mocks.assemble.mockResolvedValue({ entries: [], meta: {} });
  mocks.getScene.mockResolvedValue(craftSceneRow(scene));
}

export function resetCraftRoute() {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
}

/** Mock factory for billing entitlements (fixed 8k context budget). */
export function craftEntitlementsMock() {
  return {
    getEntitlements: async () => ({ maxContextTokens: 8000 }),
    resolveContextTokenBudget: () => 8000,
  };
}
