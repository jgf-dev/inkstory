import type {
  ImportAct,
  ImportBlock,
  ImportChapter,
  ImportManuscript,
  ImportOptions,
  ImportScene,
} from "./types";

/** Words are whitespace-separated runs that contain a letter or digit. */
export function countWords(text: string): number {
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

interface LevelMap {
  title: number | null;
  act: number | null;
  chapter: number | null;
  scene: number | null;
}

/**
 * Works out which heading level means what.
 *
 * - A single top-level heading that opens the document is the novel title.
 * - Three or more remaining levels: act, chapter, scene (export layout).
 * - Two levels: chapter + scene, or act + chapter when scene breaks are used.
 * - One level: chapters (scenes split on breaks).
 */
export function inferLevels(blocks: ImportBlock[]): LevelMap {
  const headings = blocks.filter((b) => b.type === "heading");
  let levels = [...new Set(headings.map((h) => h.level))].sort((a, b) => a - b);
  const map: LevelMap = { title: null, act: null, chapter: null, scene: null };

  const top = levels[0];
  const tops = headings.filter((h) => h.level === top);
  if (top !== undefined && tops.length === 1 && blocks[0] === tops[0]) {
    map.title = top;
    levels = levels.slice(1);
  }
  const hasBreaks = blocks.some((b) => b.type === "break");
  if (levels.length >= 3) [map.act, map.chapter, map.scene] = levels;
  else if (levels.length === 2 && hasBreaks) [map.act, map.chapter] = levels;
  else if (levels.length === 2) [map.chapter, map.scene] = levels;
  else if (levels.length === 1) map.chapter = levels[0];
  return map;
}

/** Builds the act → chapter → scene tree from blocks. */
export function buildManuscript(blocks: ImportBlock[], options: ImportOptions): ImportManuscript {
  const levels = inferLevels(blocks);
  const manuscript: ImportManuscript = { title: null, subtitle: null, acts: [] };
  let afterTitle = false;
  let act: ImportAct | null = null;
  let chapter: ImportChapter | null = null;
  let scene: (ImportScene & { body: string[]; quotes: string[] }) | null = null;

  const ensureAct = (): ImportAct => {
    if (!act) {
      act = { title: `Act ${manuscript.acts.length + 1}`, chapters: [] };
      manuscript.acts.push(act);
    }
    return act;
  };
  const ensureChapter = (): ImportChapter => {
    if (!chapter) {
      const a = ensureAct();
      chapter = { title: `Chapter ${a.chapters.length + 1}`, scenes: [] };
      a.chapters.push(chapter);
    }
    return chapter;
  };
  const startScene = (title?: string) => {
    const c = ensureChapter();
    scene = {
      title: title ?? `Scene ${c.scenes.length + 1}`,
      subtitle: null,
      summary: null,
      content: "",
      wordCount: 0,
      body: [],
      quotes: [],
    };
    c.scenes.push(scene);
  };
  const ensureScene = () => {
    if (!scene) startScene();
    return scene!;
  };

  for (const block of blocks) {
    const titleSub = afterTitle;
    afterTitle = block.type === "heading" && block.level === levels.title;
    if (block.type === "subtitle" && titleSub && manuscript.subtitle === null) {
      manuscript.subtitle = block.text;
      continue;
    }
    if (block.type === "heading") {
      if (block.level === levels.title) {
        manuscript.title = block.text;
      } else if (block.level === levels.act) {
        act = { title: block.text, chapters: [] };
        manuscript.acts.push(act);
        chapter = null;
        scene = null;
      } else if (block.level === levels.chapter) {
        chapter = null;
        scene = null;
        const a = ensureAct();
        chapter = { title: block.text, scenes: [] };
        a.chapters.push(chapter);
      } else if (block.level === levels.scene) {
        startScene(block.text);
      } else {
        // Deeper, unmapped heading: keep it as prose.
        ensureScene().body.push(block.text);
      }
    } else if (block.type === "break") {
      // A break before any prose in the scene is redundant.
      const s = scene as (ImportScene & { body: string[]; quotes: string[] }) | null;
      if (s && (s.body.length || s.quotes.length)) startScene();
    } else if (block.type === "subtitle") {
      const s = ensureScene();
      if (s.subtitle === null && !s.body.length && !s.quotes.length) s.subtitle = block.text;
      else s.body.push(`_${block.text}_`);
    } else if (block.type === "quote") {
      if (options.summaries) ensureScene().quotes.push(block.text);
      else ensureScene().body.push(block.text);
    } else {
      ensureScene().body.push(block.text);
    }
  }

  for (const a of manuscript.acts) {
    for (const c of a.chapters) {
      for (let i = 0; i < c.scenes.length; i++) {
        const s = c.scenes[i] as ImportScene & { body?: string[]; quotes?: string[] };
        const content = (s.body ?? []).join("\n\n").trim();
        const summary = (s.quotes ?? []).join("\n\n").trim();
        c.scenes[i] = {
          title: s.title,
          subtitle: s.subtitle,
          summary: summary || null,
          content,
          wordCount: countWords(content),
        };
      }
    }
  }
  return manuscript;
}
