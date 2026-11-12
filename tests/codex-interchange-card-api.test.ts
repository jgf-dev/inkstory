import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { POST as previewRoute } from "../src/app/api/codex/interchange/card/preview/route";
import { POST as importRoute } from "../src/app/api/codex/interchange/card/import/route";
import { POST as exportRoute } from "../src/app/api/codex/interchange/card/export/route";
import * as cards from "../src/lib/codex/interchange/card-service";
import { CodexError } from "../src/lib/codex/errors";
import { CARD_MAX_BODY_BYTES } from "../src/lib/codex/interchange/http";

const mockGetUser = vi.fn();
vi.mock("../src/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn().mockResolvedValue({
    auth: { getUser: () => mockGetUser() },
  }),
}));

const base = "http://localhost:3000/api/codex/interchange/card";

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(`${base}/${path}`, {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers,
  });
}

describe("Character card interchange routes (STO-1263)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
  });

  it("returns 401 when unauthenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    for (const [route, path] of [
      [previewRoute, "preview"],
      [importRoute, "import"],
      [exportRoute, "export"],
    ] as const) {
      const res = await route(post(path, {}));
      expect(res.status).toBe(401);
    }
  });

  it("previews a card without writing and maps codec errors to 422", async () => {
    const content = JSON.stringify({ spec: "chara_card_v2", data: { name: "Wren" } });
    const res = await previewRoute(post("preview", { encoding: "json", content }));
    expect(res.status).toBe(200);
    expect((await res.json<any>()).preview).toMatchObject({ name: "Wren", sourceVersion: "v2" });

    const bad = await previewRoute(post("preview", { encoding: "json", content: "[1]" }));
    expect(bad.status).toBe(422);
  });

  it("allows PNG-sized bodies but still enforces a cap", async () => {
    expect(CARD_MAX_BODY_BYTES).toBeGreaterThan(8 * 1024 * 1024);
    const tooLarge = await previewRoute(
      post("preview", { content: "x" }, { "content-length": String(CARD_MAX_BODY_BYTES + 1) }),
    );
    expect(tooLarge.status).toBe(413);
  });

  it("passes import options through and returns 201", async () => {
    const result = {
      groupId: "g",
      character: { id: "c", name: "W" },
      bookEntries: [],
      warnings: [],
    };
    const spy = vi.spyOn(cards, "importCharacterCard").mockResolvedValue(result);
    const res = await importRoute(
      post("import", {
        encoding: "png",
        content: "AAAA",
        novelId: "n1",
        importEmbeddedBook: true,
        bookActivationOverrides: { "1": "DETECTED" },
      }),
    );
    expect(res.status).toBe(201);
    expect(spy).toHaveBeenCalledWith(
      "user-1",
      { encoding: "png", content: "AAAA" },
      {
        novelId: "n1",
        seriesId: null,
        seriesScoped: false,
        importEmbeddedBook: true,
        bookActivationOverrides: { "1": "DETECTED" },
      },
    );

    await importRoute(post("import", { content: "{}", seriesId: "s1", seriesScoped: true }));
    expect(spy).toHaveBeenLastCalledWith(
      "user-1",
      { encoding: undefined, content: "{}" },
      expect.objectContaining({ novelId: null, seriesId: "s1", importEmbeddedBook: false }),
    );
  });

  it("surfaces service errors with their status", async () => {
    vi.spyOn(cards, "importCharacterCard").mockRejectedValue(
      new CodexError("Plan limit reached", "QUOTA_EXCEEDED", 402),
    );
    const res = await importRoute(post("import", { content: "{}", novelId: "n1" }));
    expect(res.status).toBe(402);
  });

  it("exports one entry", async () => {
    const spy = vi.spyOn(cards, "exportCharacterCard").mockResolvedValue({
      filename: "wren.png",
      card: {},
      png: "AAAA",
      warnings: [],
    });
    const res = await exportRoute(
      post("export", { entryId: "e1", format: "png", portrait: "BBBB", extra: 1 }),
    );
    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledWith("user-1", { entryId: "e1", format: "png", portrait: "BBBB" });
    expect((await res.json<any>()).filename).toBe("wren.png");
  });
});
