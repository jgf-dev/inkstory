import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { GET as matrixRoute } from "../src/app/api/codex/interchange/matrix/route";
import { getInterchangeMatrix } from "../src/lib/codex/interchange/matrix";

const authContext = { getUser: vi.fn() };
vi.mock("../src/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ auth: authContext }),
}));

describe("Codex interchange matrix route (STO-1261)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    authContext.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
  });

  it("returns 401 when unauthenticated", async () => {
    authContext.getUser.mockResolvedValue({ data: { user: null } });
    const res = await matrixRoute();
    expect(res.status).toBe(401);
  });

  it("returns the agreed variant matrix and policy", async () => {
    const res = await matrixRoute();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(getInterchangeMatrix());
  });
});
