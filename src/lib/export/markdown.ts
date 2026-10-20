import type { ExportNovel, ExportOptions } from "./types";

type RenderOptions = Omit<ExportOptions, "format" | "actIds" | "chapterIds" | "sceneIds">;

/** Scene separator used when scene titles are hidden. */
export const SCENE_BREAK = "* * *";

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function blockquote(text: string): string {
  return text
    .trim()
    .split("\n")
    .map((line) => (line.trim() === "" ? ">" : `> ${line}`))
    .join("\n");
}

/**
 * Renders the (already selected) novel as Markdown.
 *
 * Structure is stable so the file can be re-imported: `#` novel, `##` act,
 * `###` chapter, `####` scene, subtitles as an italic line under their
 * heading, summaries as a blockquote, prose verbatim.
 */
export function renderMarkdown(novel: ExportNovel, options: RenderOptions): string {
  const out: string[] = [`# ${oneLine(novel.title)}`];
  if (options.includeSubtitles && novel.subtitle) out.push(`_${oneLine(novel.subtitle)}_`);

  let firstScene = true;
  for (const act of novel.acts) {
    if (options.includeActTitles) {
      out.push(`## ${oneLine(act.title)}`);
      firstScene = true;
    }
    for (const chapter of act.chapters) {
      if (options.includeChapterTitles) {
        out.push(`### ${oneLine(chapter.title)}`);
        firstScene = true;
      }
      for (const scene of chapter.scenes) {
        if (options.includeSceneTitles) {
          out.push(`#### ${oneLine(scene.title)}`);
        } else if (!firstScene) {
          out.push(SCENE_BREAK);
        }
        firstScene = false;
        if (options.includeSubtitles && scene.subtitle) out.push(`_${oneLine(scene.subtitle)}_`);
        if (options.content !== "prose" && scene.summary?.trim()) {
          out.push(blockquote(scene.summary));
        }
        if (options.content !== "summary" && scene.content.trim()) {
          out.push(scene.content.trim());
        }
      }
    }
  }
  return `${out.join("\n\n")}\n`;
}

export interface ParsedMarkdownScene {
  act: string | null;
  chapter: string | null;
  title: string;
  subtitle: string | null;
  summary: string | null;
  content: string;
}

/**
 * Parses Markdown produced by {@link renderMarkdown} (with all headings on)
 * back into scenes. Used to check that export round-trips.
 */
export function parseExportedMarkdown(markdown: string): {
  title: string | null;
  scenes: ParsedMarkdownScene[];
} {
  let title: string | null = null;
  let act: string | null = null;
  let chapter: string | null = null;
  const scenes: ParsedMarkdownScene[] = [];
  let current: (ParsedMarkdownScene & { body: string[]; quote: string[] }) | null = null;

  const flush = () => {
    if (!current) return;
    const { body, quote, ...rest } = current;
    scenes.push({
      ...rest,
      summary: quote.length ? quote.join("\n").trim() : null,
      content: body.join("\n").trim(),
    });
    current = null;
  };

  for (const line of markdown.split("\n")) {
    const heading = /^(#{1,4}) (.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      if (level === 4) {
        flush();
        current = {
          act,
          chapter,
          title: heading[2],
          subtitle: null,
          summary: null,
          content: "",
          body: [],
          quote: [],
        };
        continue;
      }
      flush();
      if (level === 1) title = heading[2];
      if (level === 2) act = heading[2];
      if (level === 3) chapter = heading[2];
      continue;
    }
    if (!current) continue;
    const sub = /^_(.*)_$/.exec(line);
    const untouched = current.body.every((l) => l.trim() === "") && current.quote.length === 0;
    if (sub && current.subtitle === null && untouched) {
      current.subtitle = sub[1];
    } else if (line.startsWith(">")) {
      current.quote.push(line.replace(/^> ?/, ""));
    } else {
      current.body.push(line);
    }
  }
  flush();
  return { title, scenes };
}
