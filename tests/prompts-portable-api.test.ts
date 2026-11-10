import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { GET as exportRoute } from "../src/app/api/prompts/components/[id]/export/route";
import { POST as importRoute } from "../src/app/api/prompts/components/import/route";
import { POST as previewRoute } from "../src/app/api/prompts/components/import/preview/route";
import { POST as createComponentRoute } from "../src/app/api/prompts/components/route";
import { PATCH as patchComponentRoute } from "../src/app/api/prompts/components/[id]/route";
import * as prompts from "../src/lib/prompts";

const mockGetUser = vi.fn();
vi.mock("../src/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn().mockResolvedValue({
    auth: { getUser: () => mockGetUser() },
  }),
}));

const envelope = {
  format: "inkstory.prompt-component",
  formatVersion: 1,
  component: {
    name: "Describe",
    description: null,
    body: "Describe {{craft.selection}}",
    role: "USER",
    contract: {
      schemaVersion: 1,
      inputs: [{ key: "craft.selection", type: "text", required: true }],
      contextSlices: ["selection"],
      output: { mode: "prose", suggestedAction: "replace_selection" },
      attribution: null,
    },
  },
} as const;

function post(url: string, body: string) {
  return new NextRequest(`http://localhost:3000${url}`, { method: "POST", body });
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe("portable prompt component API (STO-1275)", () => {
  beforeEach(() => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("all routes return 401 without a session", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    expect((await exportRoute(new NextRequest("http://localhost:3000/x"), ctx("c1"))).status).toBe(
      401,
    );
    expect((await previewRoute(post("/p", JSON.stringify(envelope)))).status).toBe(401);
    expect((await importRoute(post("/i", JSON.stringify(envelope)))).status).toBe(401);
  });

  it("GET export returns the envelope as a download", async () => {
    const spy = vi
      .spyOn(prompts, "exportComponent")
      .mockResolvedValue(envelope as unknown as prompts.PortablePromptComponentEnvelope);
    const res = await exportRoute(new NextRequest("http://localhost:3000/x"), ctx("c1"));
    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledWith("user-1", "c1");
    expect(await res.json()).toEqual(envelope);
    expect(res.headers.get("Content-Disposition")).toBe(
      'attachment; filename="describe.inkstory-prompt.json"',
    );
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("GET export falls back to a generic filename and maps errors", async () => {
    vi.spyOn(prompts, "exportComponent").mockResolvedValueOnce({
      ...envelope,
      component: { ...envelope.component, name: '../"✨"' },
    } as unknown as prompts.PortablePromptComponentEnvelope);
    const res = await exportRoute(new NextRequest("http://localhost:3000/x"), ctx("c1"));
    expect(res.headers.get("Content-Disposition")).toBe(
      'attachment; filename="prompt-component.inkstory-prompt.json"',
    );

    vi.spyOn(prompts, "exportComponent").mockRejectedValueOnce(
      new prompts.PromptError("Component not found", "NOT_FOUND", 404),
    );
    const missing = await exportRoute(new NextRequest("http://localhost:3000/x"), ctx("nope"));
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "Component not found", code: "NOT_FOUND" });
  });

  it("POST import/preview validates without persisting", async () => {
    const create = vi.spyOn(prompts, "createComponent");
    const res = await previewRoute(post("/p", JSON.stringify(envelope)));
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.preview.features.inputs).toEqual([
      { key: "craft.selection", type: "text", required: true },
    ]);
    expect(json.preview.warnings).toEqual([]);
    expect(create).not.toHaveBeenCalled();
  });

  it("POST import/preview reports precise errors", async () => {
    const bad = await previewRoute(post("/p", JSON.stringify({ ...envelope, formatVersion: 2 })));
    expect(bad.status).toBe(422);
    expect(((await bad.json()) as any).code).toBe("UNSUPPORTED_VERSION");

    const malformed = await previewRoute(post("/p", "{oops"));
    expect(malformed.status).toBe(400);
    expect(((await malformed.json()) as any).code).toBe("INVALID_JSON");

    const huge = await previewRoute(post("/p", " ".repeat(300 * 1024)));
    expect(huge.status).toBe(413);
  });

  it("POST import creates a component for the session user", async () => {
    const spy = vi.spyOn(prompts, "importComponent").mockResolvedValue({
      id: "new-id",
      name: "Describe",
      description: null,
      body: "Describe {{craft.selection}}",
      role: "USER",
      contract: null,
      ownerId: "user-1",
      updatedAt: "now",
    });
    const res = await importRoute(post("/i", JSON.stringify(envelope)));
    expect(res.status).toBe(201);
    expect(spy).toHaveBeenCalledWith("user-1", envelope);
    expect(((await res.json()) as any).component.ownerId).toBe("user-1");
  });

  it("POST import rejects files that try to set ownership", async () => {
    const res = await importRoute(
      post(
        "/i",
        JSON.stringify({ ...envelope, component: { ...envelope.component, ownerId: "user-2" } }),
      ),
    );
    expect(res.status).toBe(422);
    expect(((await res.json()) as any).code).toBe("INVALID_PORTABLE");
  });

  it("component create/update routes pass contracts through for validation", async () => {
    const create = vi
      .spyOn(prompts, "createComponent")
      .mockRejectedValueOnce(
        new prompts.PromptError(
          "Invalid contract at contract: must be an object",
          "INVALID_CONTRACT",
          422,
        ),
      );
    const createRes = await createComponentRoute(
      post("/c", JSON.stringify({ name: "x", body: "y", contract: "nope" })),
    );
    expect(createRes.status).toBe(422);
    expect(create).toHaveBeenCalledWith("user-1", { name: "x", body: "y", contract: "nope" });

    const update = vi.spyOn(prompts, "updateComponent").mockResolvedValueOnce({
      id: "c1",
      name: "x",
      description: null,
      body: "y",
      role: "SYSTEM",
      contract: null,
      ownerId: "user-1",
      updatedAt: "now",
    });
    const patchRes = await patchComponentRoute(
      new NextRequest("http://localhost:3000/c/c1", {
        method: "PATCH",
        body: JSON.stringify({ contract: null }),
      }),
      ctx("c1"),
    );
    expect(patchRes.status).toBe(200);
    expect(update).toHaveBeenCalledWith("user-1", "c1", { contract: null });
  });
});
