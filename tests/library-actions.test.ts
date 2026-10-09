import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { CodexError } from "../src/lib/codex/errors";

const mockGetUser = vi.fn();
vi.mock("../src/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(async () => ({ auth: { getUser: () => mockGetUser() } })),
}));

const service = vi.hoisted(() => ({
  createNovel: vi.fn(),
  createSeries: vi.fn(),
  seedStarterBible: vi.fn(),
}));
vi.mock("../src/lib/library/service", () => service);

import {
  createNovelAction,
  createSeriesAction,
  seedStarterBibleAction,
} from "../src/lib/library/actions";

describe("library server actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
  });

  it("creates novels and series for the signed-in user with serialisable data", async () => {
    service.createNovel.mockResolvedValue({
      id: "n1",
      createdAt: new Date("2026-01-01T00:00:00Z"),
    });
    service.createSeries.mockResolvedValue({ id: "s1" });
    service.seedStarterBible.mockResolvedValue({ entries: 3 });

    await expect(createNovelAction({ title: "T" } as any)).resolves.toEqual({
      success: true,
      data: { id: "n1", createdAt: "2026-01-01T00:00:00.000Z" },
    });
    expect(service.createNovel).toHaveBeenCalledWith("user-1", { title: "T" });
    await expect(createSeriesAction({ title: "S" } as any)).resolves.toEqual({
      success: true,
      data: { id: "s1" },
    });
    await expect(seedStarterBibleAction()).resolves.toEqual({
      success: true,
      data: { entries: 3 },
    });
    expect(service.seedStarterBible).toHaveBeenCalledWith("user-1");
  });

  it("rejects anonymous callers with a 401", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    await expect(createNovelAction({ title: "T" } as any)).resolves.toEqual({
      success: false,
      error: "You must be logged in to perform this action",
      code: "FORBIDDEN",
      status: 401,
    });
  });

  it("maps codex, generic and unknown errors", async () => {
    service.createSeries.mockRejectedValue(new CodexError("Quota reached", "QUOTA_EXCEEDED", 402));
    await expect(createSeriesAction({ title: "S" } as any)).resolves.toMatchObject({
      success: false,
      code: "QUOTA_EXCEEDED",
      status: 402,
    });
    service.seedStarterBible.mockRejectedValue(new Error("db down"));
    await expect(seedStarterBibleAction()).resolves.toEqual({
      success: false,
      error: "db down",
      code: "INTERNAL_ERROR",
      status: 500,
    });
    service.createNovel.mockRejectedValue("weird");
    await expect(createNovelAction({ title: "T" } as any)).resolves.toMatchObject({
      error: "An unexpected error occurred",
      status: 500,
    });
  });
});
