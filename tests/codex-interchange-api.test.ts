import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { POST as previewRoute } from "../src/app/api/codex/interchange/lorebook/preview/route";
import { POST as importRoute } from "../src/app/api/codex/interchange/lorebook/import/route";
import { POST as exportRoute } from "../src/app/api/codex/interchange/lorebook/export/route";
import * as interchange from "../src/lib/codex/interchange/service";
import { CodexError } from "../src/lib/codex/errors";

const mockGetUser = vi.fn();
vi.mock("../src/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn().mockResolvedValue({
    auth: { getUser: () => mockGetUser() },
  }),
}));

const base = "http://localhost:3000/api/codex/interchange/lorebook";

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(`${base}/${path}`, {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers,
  });
}

describe("Codex lorebook interchange routes (STO-1262)", () => {
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

  it("previews a lorebook without writing", async () => {
    const res = await previewRoute(
      post("preview", { content: JSON.stringify({ entries: [{ key: ["A"], content: "x" }] }) }),
    );
    expect(res.status).toBe(200);
    const json = await res.json<any>();
    expect(json.preview).toMatchObject({ entryCount: 1, entries: [{ name: "A" }] });
  });

  it("maps codec validation errors to 422 and bad bodies to 400/413", async () => {
    const invalid = await previewRoute(post("preview", { content: "not json" }));
    expect(invalid.status).toBe(422);

    const malformed = await previewRoute(post("preview", "{oops"));
    expect(malformed.status).toBe(400);
    expect((await malformed.json<any>()).code).toBe("INVALID_JSON");

    const notObject = await previewRoute(post("preview", "[1]"));
    expect(notObject.status).toBe(400);

    const declaredTooLarge = await previewRoute(
      post("preview", { content: "x" }, { "content-length": String(100 * 1024 * 1024) }),
    );
    expect(declaredTooLarge.status).toBe(413);

    const actualTooLarge = await previewRoute(post("preview", "x".repeat(7 * 1024 * 1024)));
    expect(actualTooLarge.status).toBe(413);
  });

  it("passes import options through and returns 201", async () => {
    const spy = vi
      .spyOn(interchange, "importLorebook")
      .mockResolvedValue({ groupId: "g", created: [], warnings: [] });
    const res = await importRoute(
      post("import", {
        content: "{}",
        novelId: "n1",
        type: "LORE",
        activationOverrides: { "1": "DETECTED" },
      }),
    );
    expect(res.status).toBe(201);
    expect(spy).toHaveBeenCalledWith("user-1", "{}", {
      novelId: "n1",
      seriesId: null,
      seriesScoped: false,
      type: "LORE",
      activationOverrides: { "1": "DETECTED" },
    });

    await importRoute(post("import", { content: "{}", seriesId: "s1", seriesScoped: true }));
    expect(spy).toHaveBeenLastCalledWith(
      "user-1",
      "{}",
      expect.objectContaining({ novelId: null, seriesId: "s1", seriesScoped: true }),
    );
  });

  it("surfaces service errors with their status", async () => {
    vi.spyOn(interchange, "importLorebook").mockRejectedValue(
      new CodexError("Plan limit reached", "QUOTA_EXCEEDED", 402),
    );
    const res = await importRoute(post("import", { content: "{}", novelId: "n1" }));
    expect(res.status).toBe(402);
  });

  it("exports selected entries", async () => {
    const spy = vi.spyOn(interchange, "exportLorebook").mockResolvedValue({
      filename: "lorebook.json",
      lorebook: { entries: {} },
      warnings: [],
    });
    const res = await exportRoute(post("export", { entryIds: ["e1"], name: "Book" }));
    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledWith("user-1", { entryIds: ["e1"], name: "Book" });
    expect((await res.json<any>()).filename).toBe("lorebook.json");
  });
});
