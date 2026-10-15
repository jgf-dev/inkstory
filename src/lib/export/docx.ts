import { Document, HeadingLevel, Packer, Paragraph, TextRun, AlignmentType } from "docx";
import { SCENE_BREAK } from "./markdown";
import type { ExportNovel, ExportOptions } from "./types";

type RenderOptions = Omit<ExportOptions, "format" | "actIds" | "chapterIds" | "sceneIds">;

function paragraphs(text: string, italics = false): Paragraph[] {
  return text
    .trim()
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s*\n\s*/g, " ").trim())
    .filter((p) => p.length > 0)
    .map((p) => new Paragraph({ children: [new TextRun({ text: p, italics })] }));
}

/**
 * Renders the (already selected) novel as a DOCX document. Uses Word's
 * built-in Title / Heading 1–3 styles so the outline survives re-import.
 */
export async function renderDocx(novel: ExportNovel, options: RenderOptions): Promise<Buffer> {
  const children: Paragraph[] = [new Paragraph({ text: novel.title, heading: HeadingLevel.TITLE })];
  if (options.includeSubtitles && novel.subtitle) {
    children.push(new Paragraph({ text: novel.subtitle, style: "Subtitle" }));
  }

  let firstScene = true;
  for (const act of novel.acts) {
    if (options.includeActTitles) {
      children.push(new Paragraph({ text: act.title, heading: HeadingLevel.HEADING_1 }));
    }
    for (const chapter of act.chapters) {
      if (options.includeChapterTitles) {
        children.push(new Paragraph({ text: chapter.title, heading: HeadingLevel.HEADING_2 }));
      }
      for (const scene of chapter.scenes) {
        if (options.includeSceneTitles) {
          children.push(new Paragraph({ text: scene.title, heading: HeadingLevel.HEADING_3 }));
        } else if (!firstScene) {
          children.push(new Paragraph({ text: SCENE_BREAK, alignment: AlignmentType.CENTER }));
        }
        firstScene = false;
        if (options.includeSubtitles && scene.subtitle) {
          children.push(...paragraphs(scene.subtitle, true));
        }
        if (options.content !== "prose" && scene.summary?.trim()) {
          children.push(...paragraphs(scene.summary, true));
        }
        if (options.content !== "summary") children.push(...paragraphs(scene.content));
      }
    }
  }

  const doc = new Document({ title: novel.title, sections: [{ children }] });
  return Packer.toBuffer(doc);
}
