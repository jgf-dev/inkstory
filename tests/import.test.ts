import { Temporal } from "temporal-polyfill";
import { NextRequest } from "next/server";
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { POST as importRoute } from "../src/app/api/books/[id]/import/route";
import { GET as exportRoute } from "../src/app/api/books/[id]/export/route";
import {
  buildManuscript,
  countWords,
  detectFormat,
  docxToHtml,
  htmlToBlocks,
  importManuscript,
  ImportError,
  inferLevels,
  isSceneBreak,
  markdownToBlocks,
  MAX_IMPORT_BYTES,
  parseManuscript,
  previewManuscript,
  type ImportManuscript,
} from "../src/lib/import";
import {
  loadNovelForExport,
  parseExportedMarkdown,
  parseExportOptions,
  renderDocx,
  renderMarkdown,
  type ExportNovel,
} from "../src/lib/export";
import { db } from "../src/lib/prisma";

const mockGetUser = vi.fn();
vi.mock("../src/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn().mockResolvedValue({
    auth: { getUser: () => mockGetUser() },
  }),
}));

const opts = { summaries: true };

const exportedMd = `# The Glass Tide

_A Novel_

## Act One

### Arrival

#### Harbor

_Dawn_

> Mira arrives.

Mira stepped off the ferry.

The gulls screamed.

#### Inn

She took a room.

## Act Two

### Storm

#### Squall

> It rains.
> Hard.

Rain fell for days.
`;

function shape(m: ImportManuscript) {
  return m.acts.map((a) => ({
    title: a.title,
    chapters: a.chapters.map((c) => ({ title: c.title, scenes: c.scenes.map((s) => s.title) })),
  }));
}

describe("helpers", () => {
  it("counts words", () => {
    expect(countWords("  Mira stepped — off the ferry. ")).toBe(5);
    expect(countWords("")).toBe(0);
    expect(countWords("l'été 2026 *")).toBe(2);
  });

  it("recognises scene breaks", () => {
    for (const b of ["* * *", "***", "---", "- - -", "___", "#", "§"]) {
      expect(isSceneBreak(b)).toBe(true);
    }
    expect(isSceneBreak("** bold **")).toBe(false);
    expect(isSceneBreak("--")).toBe(false);
  });

  it("detects formats", () => {
    expect(detectFormat("book.MD")).toBe("md");
    expect(detectFormat("book.markdown")).toBe("md");
    expect(detectFormat("book.htm")).toBe("html");
    expect(detectFormat("book.html")).toBe("html");
    expect(detectFormat("book.docx")).toBe("docx");
    expect(detectFormat("book.txt", "docx")).toBe("docx");
    expect(() => detectFormat("book.pdf")).toThrow(ImportError);
    expect(() => detectFormat("")).toThrow(/Unsupported/);
  });
});

describe("markdown import", () => {
  it("parses the export layout into acts, chapters and scenes", () => {
    const m = buildManuscript(markdownToBlocks(exportedMd), opts);
    expect(m.title).toBe("The Glass Tide");
    expect(shape(m)).toEqual([
      { title: "Act One", chapters: [{ title: "Arrival", scenes: ["Harbor", "Inn"] }] },
      { title: "Act Two", chapters: [{ title: "Storm", scenes: ["Squall"] }] },
    ]);
    const harbor = m.acts[0].chapters[0].scenes[0];
    expect(harbor).toEqual({
      title: "Harbor",
      subtitle: "Dawn",
      summary: "Mira arrives.",
      content: "Mira stepped off the ferry.\n\nThe gulls screamed.",
      wordCount: 8,
    });
    expect(m.acts[1].chapters[0].scenes[0].summary).toBe("It rains.\nHard.");
  });

  it("keeps blockquotes as prose when summaries are off", () => {
    const m = buildManuscript(markdownToBlocks(exportedMd), { summaries: false });
    const squall = m.acts[1].chapters[0].scenes[0];
    expect(squall.summary).toBeNull();
    expect(squall.content).toBe("It rains.\nHard.\n\nRain fell for days.");
  });

  it("splits chapters on scene breaks and invents act and scene names", () => {
    const md = "# One\n\nA b.\n\n* * *\n\nC d e.\n\n# Two\n\n***\n\nF.\n";
    const m = buildManuscript(markdownToBlocks(md), opts);
    expect(m.title).toBeNull();
    expect(shape(m)).toEqual([
      {
        title: "Act 1",
        chapters: [
          { title: "One", scenes: ["Scene 1", "Scene 2"] },
          { title: "Two", scenes: ["Scene 1"] },
        ],
      },
    ]);
    expect(previewManuscript(m).totals.words).toBe(6);
  });

  it("treats two levels without breaks as chapter + scene", () => {
    const md = "# Book\n\n## Ch\n\n### S1\n\nx\n\n### S2\n\ny\n\n_not a subtitle_\n";
    const m = buildManuscript(markdownToBlocks(md), opts);
    expect(m.title).toBe("Book");
    expect(shape(m)).toEqual([
      { title: "Act 1", chapters: [{ title: "Ch", scenes: ["S1", "S2"] }] },
    ]);
    expect(m.acts[0].chapters[0].scenes[1].content).toBe("y\n\n_not a subtitle_");
  });

  it("treats two levels with breaks as act + chapter", () => {
    const md = "## A\n\n### C\n\nx\n\n---\n\ny\n\n## B\n\n### D\n\nz\n";
    expect(inferLevels(markdownToBlocks(md))).toEqual({
      title: null,
      act: 2,
      chapter: 3,
      scene: null,
    });
    const m = buildManuscript(markdownToBlocks(md), opts);
    expect(shape(m)).toEqual([
      { title: "A", chapters: [{ title: "C", scenes: ["Scene 1", "Scene 2"] }] },
      { title: "B", chapters: [{ title: "D", scenes: ["Scene 1"] }] },
    ]);
  });

  it("keeps headings deeper than the scene level as prose", () => {
    const m = buildManuscript(
      markdownToBlocks("# T\n\n## A\n\n### C\n\n#### S\n\nx\n\n##### deep\n"),
      opts,
    );
    expect(m.acts[0].chapters[0].scenes[0].content).toBe("x\n\ndeep");
  });

  it("puts heading-less text in one scene and handles CRLF and repeat subtitles", () => {
    const m = buildManuscript(markdownToBlocks("Just prose.\r\n\r\nMore."), opts);
    expect(shape(m)).toEqual([
      { title: "Act 1", chapters: [{ title: "Chapter 1", scenes: ["Scene 1"] }] },
    ]);
    expect(m.acts[0].chapters[0].scenes[0].content).toBe("Just prose.\n\nMore.");
    const subs = buildManuscript(
      [
        { type: "subtitle", text: "one" },
        { type: "subtitle", text: "two" },
      ],
      opts,
    );
    expect(subs.acts[0].chapters[0].scenes[0]).toMatchObject({ subtitle: "one", content: "_two_" });
  });

  it("parses a quote right after a paragraph and text after a quote", () => {
    expect(markdownToBlocks("para\n> q\nafter")).toEqual([
      { type: "paragraph", text: "para" },
      { type: "quote", text: "q" },
      { type: "paragraph", text: "after" },
    ]);
  });
});

describe("html import", () => {
  const html = `<!doctype html><html><head><title>x</title><style>p{}</style></head><body>
    <h1>The Glass Tide</h1>
    <h2>Act One</h2><h3>Arrival</h3>
    <h4>Harbor</h4><p><em>Dawn</em></p>
    <blockquote><p>Mira arrives.</p></blockquote>
    <p>Mira stepped <b>off</b> the&nbsp;ferry.</p><p>Line one<br>line two</p>
    <hr><p>After the break.</p>
    <ul><li>A list item</li></ul>
    <h3>Empty</h3>
    <h2>Act Two</h2><h3>Storm</h3><h4>Squall</h4>
    <blockquote>Bare quote</blockquote><p>* * *</p><div>Loose text</div>
    <script>alert(1)</script>
  </body></html>`;

  it("parses headings, subtitles, quotes, breaks and prose", () => {
    const m = buildManuscript(htmlToBlocks(html), opts);
    expect(m.title).toBe("The Glass Tide");
    expect(shape(m)).toEqual([
      {
        title: "Act One",
        chapters: [
          { title: "Arrival", scenes: ["Harbor", "Scene 2"] },
          { title: "Empty", scenes: [] },
        ],
      },
      { title: "Act Two", chapters: [{ title: "Storm", scenes: ["Squall", "Scene 2"] }] },
    ]);
    const [harbor, after] = m.acts[0].chapters[0].scenes;
    expect(harbor.subtitle).toBe("Dawn");
    expect(harbor.summary).toBe("Mira arrives.");
    expect(harbor.content).toBe("Mira stepped off the ferry.\n\nLine one\nline two");
    expect(after.content).toBe("After the break.\n\nA list item");
    expect(m.acts[1].chapters[0].scenes[0].summary).toBe("Bare quote");
    expect(m.acts[1].chapters[0].scenes[1].content).toBe("Loose text");
    expect(JSON.stringify(m)).not.toContain("alert");
  });

  it("previews structure, word counts and warnings", () => {
    const p = previewManuscript(buildManuscript(htmlToBlocks(html), opts));
    expect(p.totals).toEqual({ acts: 2, chapters: 3, scenes: 4, words: 17, summaries: 2 });
    expect(p.acts[0].wordCount).toBe(15);
    expect(p.acts[0].chapters[0].scenes[0]).toEqual({
      title: "Harbor",
      wordCount: 9,
      hasSummary: true,
    });
    expect(p.warnings).toEqual(['Chapter "Empty" has no scenes.']);
    expect(
      previewManuscript({ title: null, subtitle: null, acts: [{ title: "A", chapters: [] }] })
        .warnings,
    ).toEqual(['Act "A" has no chapters.', "No content was found to import."]);
    const empty = previewManuscript({
      title: null,
      subtitle: null,
      acts: [
        {
          title: "A",
          chapters: [
            {
              title: "C",
              scenes: [{ title: "S", subtitle: null, summary: null, content: "", wordCount: 0 }],
            },
          ],
        },
      ],
    });
    expect(empty.warnings).toEqual(['Scene "S" in "C" is empty.']);
  });

  it("marks a class=subtitle paragraph and ignores empty nodes", () => {
    expect(htmlToBlocks('<p class="subtitle">Sub</p><p> </p><h2> </h2>text')).toEqual([
      { type: "subtitle", text: "Sub" },
      { type: "paragraph", text: "text" },
    ]);
  });
});

describe("docx import", () => {
  it("maps Word heading styles and quotes", async () => {
    const doc = new Document({
      sections: [
        {
          children: [
            new Paragraph({ text: "Book", heading: HeadingLevel.TITLE }),
            new Paragraph({ text: "Part I", heading: HeadingLevel.HEADING_1 }),
            new Paragraph({ text: "One", heading: HeadingLevel.HEADING_2 }),
            new Paragraph({ text: "Opening", heading: HeadingLevel.HEADING_3 }),
            new Paragraph({ text: "The summary.", style: "Quote" }),
            new Paragraph({ children: [new TextRun("Some prose here.")] }),
          ],
        },
      ],
    });
    const buffer = await Packer.toBuffer(doc);
    const m = await parseManuscript(buffer, "docx", opts);
    expect(m.title).toBe("Book");
    expect(shape(m)).toEqual([
      { title: "Part I", chapters: [{ title: "One", scenes: ["Opening"] }] },
    ]);
    expect(m.acts[0].chapters[0].scenes[0]).toMatchObject({
      summary: "The summary.",
      content: "Some prose here.",
      wordCount: 3,
    });
  });

  it("rejects a broken docx", async () => {
    await expect(docxToHtml(Buffer.from("not a zip"))).rejects.toMatchObject({ status: 400 });
  });

  it("parses md and html from strings", async () => {
    expect((await parseManuscript("# T\n\n## A\n\n### C\n\n#### S\n\nx", "md", opts)).title).toBe(
      "T",
    );
    expect((await parseManuscript(Buffer.from("<h1>T</h1><p>x</p>"), "html", opts)).title).toBe(
      "T",
    );
  });
});

describe("export → import round-trip (in memory)", () => {
  const novel: ExportNovel = {
    id: "n1",
    title: "The Glass Tide",
    subtitle: null,
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
                content: "Mira stepped off.\n\nGulls.",
                summary: "Arrives.",
              },
              {
                id: "s2",
                title: "Inn",
                subtitle: null,
                content: "She took a room.",
                summary: null,
              },
            ],
          },
        ],
      },
    ],
  };
  const all = parseExportOptions(new URLSearchParams("content=both"));

  it("markdown matches parseExportedMarkdown", async () => {
    const md = renderMarkdown(novel, all);
    const m = await parseManuscript(md, "md", opts);
    const scenes = m.acts.flatMap((a) =>
      a.chapters.flatMap((c) =>
        c.scenes.map((s) => ({
          act: a.title,
          chapter: c.title,
          title: s.title,
          subtitle: s.subtitle,
          summary: s.summary,
          content: s.content,
        })),
      ),
    );
    expect(scenes).toEqual(parseExportedMarkdown(md).scenes);
  });

  it("docx keeps structure and prose", async () => {
    const prose = parseExportOptions(new URLSearchParams());
    const m = await parseManuscript(await renderDocx(novel, prose), "docx", opts);
    expect(m.title).toBe("The Glass Tide");
    expect(shape(m)).toEqual([
      { title: "Act One", chapters: [{ title: "Arrival", scenes: ["Harbor", "Inn"] }] },
    ]);
    expect(m.acts[0].chapters[0].scenes[0]).toMatchObject({
      subtitle: "Dawn",
      content: "Mira stepped off.\n\nGulls.",
    });
  });

  it("docx reads Quote-style summaries back as summaries", async () => {
    const m = await parseManuscript(await renderDocx(novel, all), "docx", opts);
    const [harbor, inn] = m.acts[0].chapters[0].scenes;
    expect(harbor).toMatchObject({
      subtitle: "Dawn",
      summary: "Arrives.",
      content: "Mira stepped off.\n\nGulls.",
    });
    expect(inn.summary).toBeNull();
    const off = await parseManuscript(await renderDocx(novel, all), "docx", { summaries: false });
    expect(off.acts[0].chapters[0].scenes[0]).toMatchObject({
      summary: null,
      content: "Arrives.\n\nMira stepped off.\n\nGulls.",
    });
  });
});

describe("import service + route (database)", { timeout: 30_000 }, () => {
  const runId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const otherUserId = crypto.randomUUID();
  const novelId = `test-import-novel-${runId}`;
  const deletedNovelId = `test-import-novel-deleted-${runId}`;

  const post = (id: string, fields: Record<string, string | Blob>) => {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    return importRoute(
      new NextRequest(`http://localhost/api/books/${id}/import`, { method: "POST", body: form }),
      {
        params: Promise.resolve({ id }),
      },
    );
  };
  const mdFile = (text: string, name = "book.md") =>
    new File([text], name, { type: "text/markdown" });

  beforeAll(async () => {
    const now = Temporal.Now.plainDateTimeISO();
    for (const id of [userId, otherUserId]) {
      await db.orm.public.User.upsert({
        create: { id, email: `import-${id}@inkstory.local`, updatedAt: now },
        update: { updatedAt: now },
      });
    }
    await db.orm.public.Novel.create({
      id: novelId,
      ownerId: userId,
      title: "Import Test",
      updatedAt: now,
    });
    await db.orm.public.Novel.create({
      id: deletedNovelId,
      ownerId: userId,
      title: "Gone",
      updatedAt: now,
      deletedAt: now,
    });
    await db.orm.public.Act.create({
      id: `test-import-existing-${runId}`,
      novelId,
      title: "Existing",
      position: 0,
      updatedAt: now,
    });
  });

  afterAll(async () => {
    await db.orm.public.Novel.where({ id: novelId }).delete();
    await db.orm.public.Novel.where({ id: deletedNovelId }).delete();
    for (const id of [userId, otherUserId]) await db.orm.public.User.where({ id }).delete();
  });

  beforeEach(() => mockGetUser.mockResolvedValue({ data: { user: { id: userId } } }));

  it("returns 401 without a user", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    expect((await post(novelId, { file: mdFile("x") })).status).toBe(401);
  });

  it("returns 404 for another user's, a deleted or a missing book", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: otherUserId } } });
    expect((await post(novelId, { file: mdFile("x") })).status).toBe(404);
    mockGetUser.mockResolvedValue({ data: { user: { id: userId } } });
    expect((await post(deletedNovelId, { file: mdFile("x") })).status).toBe(404);
    expect((await post("missing", { file: mdFile("x") })).status).toBe(404);
    await expect(
      importManuscript(otherUserId, novelId, { title: null, subtitle: null, acts: [] }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("validates the upload", async () => {
    expect((await post(novelId, {})).status).toBe(400);
    expect((await post(novelId, { file: mdFile("x", "book.pdf") })).status).toBe(415);
    const big = new File([new Uint8Array(MAX_IMPORT_BYTES + 1)], "big.md");
    expect((await post(novelId, { file: big })).status).toBe(413);
    const notForm = await importRoute(
      new NextRequest(`http://localhost/api/books/${novelId}/import`, {
        method: "POST",
        body: "{}",
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id: novelId }) },
    );
    expect(notForm.status).toBe(400);
    const empty = await post(novelId, { file: mdFile("", "e.md"), confirm: "true" });
    expect(empty.status).toBe(400);
  });

  it("previews without writing", async () => {
    const res = await post(novelId, { file: mdFile(exportedMd) });
    expect(res.status).toBe(200);
    const { preview } = await res.json();
    expect(preview.totals).toEqual({ acts: 2, chapters: 2, scenes: 3, words: 16, summaries: 2 });
    const acts = await db.orm.public.Act.where((a) => a.novelId.eq(novelId)).all();
    expect(acts).toHaveLength(1);
  });

  it("returns 500 on unexpected errors", async () => {
    mockGetUser.mockRejectedValueOnce(new Error("boom"));
    expect((await post(novelId, { file: mdFile("x") })).status).toBe(500);
  });

  it("leaves nothing behind when a write fails part-way", async () => {
    const scene = { subtitle: null, summary: null, content: "x", wordCount: 1 };
    const bad: ImportManuscript = {
      title: null,
      subtitle: null,
      acts: [
        {
          title: "Rollback 1",
          chapters: [{ title: `C1-${runId}`, scenes: [{ ...scene, title: `Ok-${runId}` }] }],
        },
        // NOT NULL violation on scenes.title, after act 1 has been written.
        {
          title: "Rollback 2",
          chapters: [{ title: `C2-${runId}`, scenes: [{ ...scene, title: null as never }] }],
        },
      ],
    };
    await expect(importManuscript(userId, novelId, bad)).rejects.toThrow();
    const acts = await db.orm.public.Act.where((a) => a.novelId.eq(novelId)).all();
    expect(acts.map((a) => a.title)).toEqual(["Existing"]);
    const chapters = await db.orm.public.Chapter.where((c) => c.actId.eq(acts[0].id)).all();
    expect(chapters).toHaveLength(0);
    for (const title of [`C1-${runId}`, `C2-${runId}`]) {
      expect(await db.orm.public.Chapter.where({ title }).first()).toBeNull();
    }
    expect(await db.orm.public.Scene.where({ title: `Ok-${runId}` }).first()).toBeNull();
  });

  it("import → edit → export round-trip keeps structure and text (md + docx)", async () => {
    // 1. Import (summaries on).
    const res = await post(novelId, { file: mdFile(exportedMd), confirm: "true" });
    expect(res.status).toBe(201);
    const { actIds, preview } = await res.json();
    expect(actIds).toHaveLength(2);
    expect(preview.totals.scenes).toBe(3);

    const loaded = await loadNovelForExport(userId, novelId);
    expect(loaded.acts.map((a) => a.title)).toEqual(["Existing", "Act One", "Act Two"]);
    const inn = loaded.acts[1].chapters[0].scenes[1];
    const stored = await db.orm.public.Scene.where({ id: inn.id }).first();
    expect(stored?.wordCount).toBe(4);

    // 2. Edit a scene.
    await db.orm.public.Scene.where({ id: inn.id }).update({ content: "She took the attic room." });

    // 3. Export as Markdown and DOCX via the route.
    const exp = async (q: string) =>
      exportRoute(new NextRequest(`http://localhost/api/books/${novelId}/export?${q}`), {
        params: Promise.resolve({ id: novelId }),
      });
    const md = await (await exp("format=md&content=both")).text();
    const docx = Buffer.from(await (await exp("format=docx&content=both")).arrayBuffer());

    // 4. Re-import both and compare with the edited source.
    const expected = [
      { title: "Existing", chapters: [] },
      { title: "Act One", chapters: [{ title: "Arrival", scenes: ["Harbor", "Inn"] }] },
      { title: "Act Two", chapters: [{ title: "Storm", scenes: ["Squall"] }] },
    ];
    const fromMd = await parseManuscript(md, "md", opts);
    const fromDocx = await parseManuscript(docx, "docx", opts);
    for (const m of [fromMd, fromDocx]) {
      expect(m.title).toBe("Import Test");
      expect(shape(m)).toEqual(expected);
      expect(m.acts[1].chapters[0].scenes[0]).toMatchObject({
        subtitle: "Dawn",
        content: "Mira stepped off the ferry.\n\nThe gulls screamed.",
      });
      expect(m.acts[1].chapters[0].scenes[1].content).toBe("She took the attic room.");
      expect(m.acts[2].chapters[0].scenes[0].content).toBe("Rain fell for days.");
    }
    for (const m of [fromMd, fromDocx]) {
      expect(m.acts[1].chapters[0].scenes[0].summary).toBe("Mira arrives.");
      expect(m.acts[1].chapters[0].scenes[1].summary).toBeNull();
    }
    expect(fromMd.acts[2].chapters[0].scenes[0].summary).toBe("It rains.\nHard.");
    // DOCX joins a summary's lines into one Quote paragraph.
    expect(fromDocx.acts[2].chapters[0].scenes[0].summary).toBe("It rains. Hard.");
  });
});
