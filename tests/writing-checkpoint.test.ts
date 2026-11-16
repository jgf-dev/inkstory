import { Temporal } from "temporal-polyfill";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const {
  mockSceneWhere,
  mockChapterWhere,
  mockActWhere,
  mockNovelWhere,
  mockSceneRevisionCreate,
  mockSceneRevisionWhere,
} = vi.hoisted(() => ({
  mockSceneWhere: vi.fn(),
  mockChapterWhere: vi.fn(),
  mockActWhere: vi.fn(),
  mockNovelWhere: vi.fn(),
  mockSceneRevisionCreate: vi.fn(),
  mockSceneRevisionWhere: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  db: {
    orm: {
      public: {
        Scene: { where: mockSceneWhere },
        Chapter: { where: mockChapterWhere },
        Act: { where: mockActWhere },
        Novel: { where: mockNovelWhere },
        SceneRevision: {
          create: mockSceneRevisionCreate,
          where: mockSceneRevisionWhere,
        },
      },
    },
  },
}));

import { checkpointScene } from "@/lib/writing/service";

describe("checkpointScene", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockSceneWhere.mockReturnValue({
      first: vi.fn().mockResolvedValue({
        id: "scene-1",
        chapterId: "chapter-1",
        title: "Opening",
        content: "Stored prose",
        contentDoc: null,
        contentFormat: "PLAIN",
        summary: null,
        pov: "THIRD_LIMITED",
        tense: "PAST",
        wordCount: 2,
        deletedAt: null,
      }),
    });
    mockChapterWhere.mockReturnValue({
      first: vi.fn().mockResolvedValue({ id: "chapter-1", actId: "act-1", deletedAt: null }),
    });
    mockActWhere.mockReturnValue({
      first: vi.fn().mockResolvedValue({ id: "act-1", novelId: "novel-1", deletedAt: null }),
    });
    mockNovelWhere.mockReturnValue({
      first: vi.fn().mockResolvedValue({ id: "novel-1", ownerId: "user-1", deletedAt: null }),
    });
  });

  it("returns the MANUAL revision it created even if a newer AUTOSAVE exists", async () => {
    const manualTimestamp = Temporal.PlainDateTime.from("2026-11-15T15:00:00");
    const autosaveTimestamp = Temporal.PlainDateTime.from("2026-11-15T15:00:01");

    const manualRow = {
      id: "rev-manual-1",
      sceneId: "scene-1",
      title: "Opening",
      content: "Stored prose",
      contentDoc: null,
      contentFormat: "PLAIN",
      summary: null,
      pov: "THIRD_LIMITED",
      tense: "PAST",
      wordCount: 2,
      reason: "MANUAL",
      createdAt: manualTimestamp,
    };

    const autosaveRow = {
      ...manualRow,
      id: "rev-autosave-2",
      content: "Concurrent autosave prose",
      reason: "AUTOSAVE",
      createdAt: autosaveTimestamp,
    };

    mockSceneRevisionCreate.mockResolvedValueOnce(manualRow);
    // Prune query sees the newer autosave first; checkpointScene must not return it.
    mockSceneRevisionWhere.mockReturnValue({
      orderBy: vi.fn().mockReturnValue({
        all: vi.fn().mockResolvedValue([autosaveRow, manualRow]),
        limit: vi.fn().mockReturnValue({
          all: vi.fn().mockResolvedValue([autosaveRow]),
        }),
      }),
    });

    const result = await checkpointScene("user-1", "scene-1");

    expect(result.id).toBe("rev-manual-1");
    expect(result.reason).toBe("MANUAL");
    expect(result.contentPreview).toBe("Stored prose");
  });
});
