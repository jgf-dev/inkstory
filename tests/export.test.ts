import JSZip from "jszip";
import { Temporal } from "temporal-polyfill";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { GET as exportRoute } from "../src/app/api/books/[id]/export/route";
import {
  exportFilename,
  exportNovel,
  ExportError,
  parseExportedMarkdown,
  parseExportOptions,
  renderDocx,
  renderExport,
  renderMarkdown,
  SCENE_BREAK,
  selectExportTree,
  type ExportNovel,
  type ExportOptions,
} from "../src/lib/export";
import { db } from "../src/lib/prisma";

const mockGetUser = vi.fn();
vi.mock("../src/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn().mockResolvedValue({
    auth: { getUser: () => mockGetUser() },
  }),
}));

const novel: ExportNovel = {
  id: "n1",
  title: "The Glass Tide",
  subtitle: "A Novel",
  acts: [
    {
      id: "a1",
      title: "Act One",
      chapters: [
        {
          id: "c1",
          title: "Arrival",
          scenes: [
            {
              id: "s1",
              title: "Harbor",
              subtitle: "Dawn",
              content: "Mira stepped off the ferry.\n\nThe gulls screamed.",
              summary: "Mira arrives.",
            },
            { id: "s2", title: "Inn", subtitle: null, content: "She took a room.", summary: null },
          ],
        },
      ],
    },
    {
      id: "a2",
      title: "Act Two",
      chapters: [
        {
          id: "c2",
          title: "Storm",
          scenes: [
            { id: "s3", title: "Squall", subtitle: null, content: "Rain.", summary: "It rains." },
          ],
        },
      ],
    },
  ],
};

const base: ExportOptions = parseExportOptions(new URLSearchParams());

/** One act, two chapters, two scenes each: exercises per-chapter scene breaks. */
const twoChapters: ExportNovel = {
  id: "n2",
  title: "Two Chapters",
  subtitle: null,
  acts: [
    {
      id: "a1",
      title: "Only Act",
      chapters: ["One", "Two"].map((name, c) => ({
        id: `c${c}`,
        title: `Chapter ${name}`,
        scenes: [0, 1].map((s) => ({
          id: `c${c}s${s}`,
          title: `Scene ${c}.${s}`,
          subtitle: null,
          content: `Prose ${c}.${s}.`,
          summary: null,
        })),
      })),
    },
  ],
};

const untitledScenes = { ...base, includeActTitles: false, includeSceneTitles: false };

/** Paragraph style + text, in order, from a rendered DOCX. */
async function docxParagraphs(buf: Buffer): Promise<{ style: string | null; text: string }[]> {
  const xml = await (await JSZip.loadAsync(buf)).file("word/document.xml")!.async("string");
  return [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map(([p]) => ({
    style: /<w:pStyle w:val="([^"]+)"/.exec(p)?.[1] ?? null,
    text: [...p.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join(""),
  }));
}

describe("parseExportOptions", () => {
  it("applies defaults", () => {
    expect(base).toEqual({
      format: "md",
      content: "prose",
      includeActTitles: true,
      includeChapterTitles: true,
      includeSceneTitles: true,
      includeSubtitles: true,
      actIds: [],
      chapterIds: [],
      sceneIds: [],
    });
  });

  it("parses all flags and id lists", () => {
    const o = parseExportOptions(
      new URLSearchParams(
        "format=DOCX&content=both&actTitles=0&chapterTitles=no&sceneTitles=false&subtitles=yes&actIds=a1,a2&sceneIds=s1&sceneIds=s2&chapterIds=",
      ),
    );
    expect(o).toMatchObject({
      format: "docx",
      content: "both",
      includeActTitles: false,
      includeChapterTitles: false,
      includeSceneTitles: false,
      includeSubtitles: true,
      actIds: ["a1", "a2"],
      chapterIds: [],
      sceneIds: ["s1", "s2"],
    });
    expect(parseExportOptions(new URLSearchParams("subtitles=1")).includeSubtitles).toBe(true);
  });

  it.each(["format=pdf", "content=notes", "actTitles=maybe"])("rejects %s", (q) => {
    expect(() => parseExportOptions(new URLSearchParams(q))).toThrow(ExportError);
  });
});

describe("selectExportTree", () => {
  it("returns everything when nothing is selected", () => {
    expect(selectExportTree(novel, base)).toBe(novel);
  });

  it("selects by act, chapter or scene and drops empty branches", () => {
    const byScene = selectExportTree(novel, { ...base, sceneIds: ["s2"] });
    expect(byScene.acts.map((a) => a.id)).toEqual(["a1"]);
    expect(byScene.acts[0].chapters[0].scenes.map((s) => s.id)).toEqual(["s2"]);

    const byAct = selectExportTree(novel, { ...base, actIds: ["a2"] });
    expect(byAct.acts.map((a) => a.id)).toEqual(["a2"]);

    const byChapter = selectExportTree(novel, { ...base, chapterIds: ["c1"], sceneIds: ["s3"] });
    expect(
      byChapter.acts.flatMap((a) => a.chapters.flatMap((c) => c.scenes.map((s) => s.id))),
    ).toEqual(["s1", "s2", "s3"]);
  });
});

describe("renderMarkdown", () => {
  it("renders headings, subtitles and prose by default", () => {
    const md = renderMarkdown(novel, base);
    expect(md).toContain("# The Glass Tide\n\n_A Novel_");
    expect(md).toContain("## Act One");
    expect(md).toContain("### Arrival");
    expect(md).toContain(
      "#### Harbor\n\n_Dawn_\n\nMira stepped off the ferry.\n\nThe gulls screamed.",
    );
    expect(md).not.toContain("> Mira arrives.");
  });

  it("renders summaries only or both", () => {
    const summaries = renderMarkdown(novel, { ...base, content: "summary" });
    expect(summaries).toContain("> Mira arrives.");
    expect(summaries).not.toContain("ferry");

    const both = renderMarkdown(novel, { ...base, content: "both" });
    expect(both).toContain("> Mira arrives.\n\nMira stepped off the ferry.");
  });

  it("omits act titles and subtitles, and uses scene breaks without scene titles", () => {
    const md = renderMarkdown(
      {
        ...novel,
        acts: [
          {
            ...novel.acts[0],
            chapters: [
              {
                ...novel.acts[0].chapters[0],
                scenes: [
                  { ...novel.acts[0].chapters[0].scenes[0], summary: "Line one\n\nLine two" },
                  novel.acts[0].chapters[0].scenes[1],
                ],
              },
            ],
          },
        ],
      },
      {
        ...base,
        content: "both",
        includeActTitles: false,
        includeChapterTitles: false,
        includeSceneTitles: false,
        includeSubtitles: false,
      },
    );
    expect(md).not.toContain("## ");
    expect(md).not.toContain("_A Novel_");
    expect(md).not.toContain("_Dawn_");
    expect(md).toContain("> Line one\n>\n> Line two");
    expect(md.split(SCENE_BREAK)).toHaveLength(2);
  });

  it("does not put a scene break right under an act or chapter heading", () => {
    const md = renderMarkdown(novel, { ...base, includeSceneTitles: false });
    expect(md.split(SCENE_BREAK)).toHaveLength(2);
    expect(md).not.toContain(`### Storm\n\n${SCENE_BREAK}`);
  });

  it("resets scene breaks per chapter when chapter titles are shown", () => {
    const md = renderMarkdown(twoChapters, untitledScenes);
    expect(md.split(SCENE_BREAK)).toHaveLength(3);
    expect(md).not.toContain(`### Chapter One\n\n${SCENE_BREAK}`);
    expect(md).not.toContain(`### Chapter Two\n\n${SCENE_BREAK}`);
    expect(md).toContain(`Prose 0.0.\n\n${SCENE_BREAK}\n\nProse 0.1.`);
    expect(md).toContain(`Prose 1.0.\n\n${SCENE_BREAK}\n\nProse 1.1.`);
    expect(md).toContain("Prose 0.1.\n\n### Chapter Two\n\nProse 1.0.");
  });

  it("keeps scene breaks across chapters when no headings separate them", () => {
    const md = renderMarkdown(twoChapters, { ...untitledScenes, includeChapterTitles: false });
    expect(md.split(SCENE_BREAK)).toHaveLength(4);
    expect(md).toContain(`Prose 0.1.\n\n${SCENE_BREAK}\n\nProse 1.0.`);
  });

  it("round-trips through parseExportedMarkdown", () => {
    const parsed = parseExportedMarkdown(renderMarkdown(novel, { ...base, content: "both" }));
    expect(parsed.title).toBe("The Glass Tide");
    expect(parsed.scenes).toEqual([
      {
        act: "Act One",
        chapter: "Arrival",
        title: "Harbor",
        subtitle: "Dawn",
        summary: "Mira arrives.",
        content: "Mira stepped off the ferry.\n\nThe gulls screamed.",
      },
      {
        act: "Act One",
        chapter: "Arrival",
        title: "Inn",
        subtitle: null,
        summary: null,
        content: "She took a room.",
      },
      {
        act: "Act Two",
        chapter: "Storm",
        title: "Squall",
        subtitle: null,
        summary: "It rains.",
        content: "Rain.",
      },
    ]);
    expect(parseExportedMarkdown("preamble\n").scenes).toEqual([]);
  });
});

describe("renderDocx", () => {
  it("produces a valid DOCX (zip) containing the text", async () => {
    const buf = await renderDocx(novel, { ...base, content: "both" });
    expect(buf.subarray(0, 2).toString()).toBe("PK");
    const plain = await renderDocx(novel, {
      ...base,
      includeActTitles: false,
      includeChapterTitles: false,
      includeSceneTitles: false,
      includeSubtitles: false,
    });
    expect(plain.subarray(0, 2).toString()).toBe("PK");
    const texts = (await docxParagraphs(buf)).map((p) => p.text);
    expect(texts).toContain("Mira stepped off the ferry.");
    expect(texts).toContain("Mira arrives.");
  });

  it("puts scene breaks between scenes, never right under a chapter heading", async () => {
    const paras = await docxParagraphs(await renderDocx(twoChapters, untitledScenes));
    expect(paras.map((p) => p.text)).toEqual([
      "Two Chapters",
      "Chapter One",
      "Prose 0.0.",
      SCENE_BREAK,
      "Prose 0.1.",
      "Chapter Two",
      "Prose 1.0.",
      SCENE_BREAK,
      "Prose 1.1.",
    ]);
    expect(paras.find((p) => p.text === "Chapter Two")?.style).toBe("Heading2");

    const flat = await docxParagraphs(
      await renderDocx(twoChapters, { ...untitledScenes, includeChapterTitles: false }),
    );
    expect(flat.filter((p) => p.text === SCENE_BREAK)).toHaveLength(3);
  });
});

describe("renderExport / exportFilename", () => {
  it("names files and sets content types", async () => {
    expect(exportFilename("The Glass Tide!", "md")).toBe("the-glass-tide.md");
    expect(exportFilename("???", "docx")).toBe("manuscript.docx");
    const md = await renderExport(novel, base);
    expect(md.contentType).toMatch(/text\/markdown/);
    const docx = await renderExport(novel, { ...base, format: "docx" });
    expect(docx.contentType).toMatch(/wordprocessingml/);
    expect(Buffer.isBuffer(docx.body)).toBe(true);
  });
});

describe("export service + route (database)", { timeout: 20_000 }, () => {
  const runId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const otherUserId = crypto.randomUUID();
  const novelId = `test-export-novel-${runId}`;
  const deletedNovelId = `test-export-novel-deleted-${runId}`;
  const act1 = `test-export-act1-${runId}`;
  const act2 = `test-export-act2-${runId}`;
  const ch1 = `test-export-ch1-${runId}`;
  const ch2 = `test-export-ch2-${runId}`;

  beforeAll(async () => {
    const now = Temporal.Now.plainDateTimeISO();
    for (const id of [userId, otherUserId]) {
      await db.orm.public.User.upsert({
        create: { id, email: `export-${id}@inkstory.local`, updatedAt: now },
        update: { updatedAt: now },
      });
    }
    await db.orm.public.Novel.create({
      id: novelId,
      ownerId: userId,
      title: "Export Test",
      subtitle: "Sub",
      updatedAt: now,
    });
    await db.orm.public.Novel.create({
      id: deletedNovelId,
      ownerId: userId,
      title: "Gone",
      updatedAt: now,
      deletedAt: now,
    });
    // Inserted out of order to check position sorting.
    await db.orm.public.Act.create({
      id: act2,
      novelId,
      title: "Second Act",
      position: 1,
      updatedAt: now,
    });
    await db.orm.public.Act.create({
      id: act1,
      novelId,
      title: "First Act",
      position: 0,
      updatedAt: now,
    });
    await db.orm.public.Act.create({
      id: `test-export-act-del-${runId}`,
      novelId,
      title: "Deleted Act",
      position: 2,
      updatedAt: now,
      deletedAt: now,
    });
    await db.orm.public.Chapter.create({ id: ch1, actId: act1, title: "Ch One", updatedAt: now });
    await db.orm.public.Chapter.create({ id: ch2, actId: act2, title: "Ch Two", updatedAt: now });
    await db.orm.public.Scene.create({
      id: `test-export-s2-${runId}`,
      chapterId: ch1,
      title: "Later",
      content: "Second scene.",
      position: 1,
      updatedAt: now,
    });
    await db.orm.public.Scene.create({
      id: `test-export-s1-${runId}`,
      chapterId: ch1,
      title: "Opening",
      content: "First scene.",
      summary: "Opens.",
      position: 0,
      updatedAt: now,
    });
    await db.orm.public.Scene.create({
      id: `test-export-sdel-${runId}`,
      chapterId: ch1,
      title: "Cut",
      content: "Deleted prose.",
      position: 2,
      updatedAt: now,
      deletedAt: now,
    });
    await db.orm.public.Scene.create({
      id: `test-export-s3-${runId}`,
      chapterId: ch2,
      title: "Finale",
      content: "Last scene.",
      updatedAt: now,
    });
  });

  afterAll(async () => {
    await db.orm.public.Novel.where((n) => n.ownerId.eq(userId)).deleteAll();
    await db.orm.public.User.where((u) => u.id.in([userId, otherUserId])).deleteAll();
  });

  beforeEach(() => {
    mockGetUser.mockResolvedValue({ data: { user: { id: userId } } });
  });

  const call = (id: string, query = "") =>
    exportRoute(new NextRequest(`http://localhost:3000/api/books/${id}/export${query}`), {
      params: Promise.resolve({ id }),
    });

  it("exports the novel in reading order, skipping deleted rows", async () => {
    const file = await exportNovel(userId, novelId, base);
    const md = file.body as string;
    expect(md.indexOf("First Act")).toBeLessThan(md.indexOf("Second Act"));
    expect(md.indexOf("First scene.")).toBeLessThan(md.indexOf("Second scene."));
    expect(md).not.toContain("Deleted");
  });

  it("returns Markdown from the route", async () => {
    const res = await call(novelId, "?format=md&actIds=" + act2);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="export-test.md"');
    const text = await res.text();
    expect(text).toContain("Last scene.");
    expect(text).not.toContain("First scene.");
  });

  it("returns DOCX from the route", async () => {
    const res = await call(novelId, "?format=docx&content=both");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toMatch(/wordprocessingml/);
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(String.fromCharCode(bytes[0], bytes[1])).toBe("PK");
  });

  it("returns 401 and 400", async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null } });
    expect((await call(novelId)).status).toBe(401);
    expect((await call(novelId, "?format=pdf")).status).toBe(400);
  });

  it("returns 404 (not 403) for another user's book", async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: { id: otherUserId } } });
    const res = await call(novelId);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Novel not found", code: "NOT_FOUND" });
    await expect(exportNovel(otherUserId, novelId, base)).rejects.toMatchObject({
      status: 404,
      code: "NOT_FOUND",
    });
  });

  it("returns 404 for a deleted or missing book", async () => {
    expect((await call(deletedNovelId)).status).toBe(404);
    expect((await call(`missing-${runId}`)).status).toBe(404);
  });

  it("returns 500 on unexpected errors", async () => {
    mockGetUser.mockRejectedValueOnce(new Error("boom"));
    expect((await call(novelId)).status).toBe(500);
  });
});
