import { NodeType, parse, type HTMLElement, type Node } from "node-html-parser";
import type { ImportBlock } from "./types";

const BREAK_RE = /^\s*(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,}|#|§)\s*$/;

/** True for a scene-break line (`* * *`, `***`, `---`, `#`, `§`). */
export function isSceneBreak(text: string): boolean {
  return BREAK_RE.test(text);
}

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Splits Markdown into blocks. Prose paragraphs are kept verbatim (inline
 * Markdown is not stripped) so a Markdown export re-imports unchanged.
 */
export function markdownToBlocks(markdown: string): ImportBlock[] {
  const blocks: ImportBlock[] = [];
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  let para: string[] = [];
  let quote: string[] = [];
  let afterHeading = false;

  const flush = () => {
    if (para.length) {
      const text = para.join("\n").trim();
      const sub = /^_([^_\n]+)_$/.exec(text);
      if (afterHeading && sub) blocks.push({ type: "subtitle", text: sub[1].trim() });
      else if (isSceneBreak(text)) blocks.push({ type: "break" });
      else blocks.push({ type: "paragraph", text });
      afterHeading = false;
      para = [];
    }
    if (quote.length) {
      blocks.push({ type: "quote", text: quote.join("\n").trim() });
      afterHeading = false;
      quote = [];
    }
  };

  for (const line of lines) {
    const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading && heading[2] !== "") {
      flush();
      blocks.push({ type: "heading", level: heading[1].length, text: collapse(heading[2]) });
      afterHeading = true;
    } else if (/^ {0,3}>/.test(line)) {
      if (para.length) flush();
      quote.push(line.replace(/^ {0,3}> ?/, ""));
    } else if (line.trim() === "") {
      flush();
    } else {
      if (quote.length) flush();
      para.push(line);
    }
  }
  flush();
  return blocks;
}

function isElement(node: Node): node is HTMLElement {
  return node.nodeType === NodeType.ELEMENT_NODE;
}

/** Text of an element with `<br>` kept as newlines and whitespace collapsed per line. */
function elementText(el: HTMLElement): string {
  const parts: string[] = [];
  const walk = (node: Node) => {
    if (isElement(node)) {
      if (node.tagName === "BR") parts.push("\n");
      else node.childNodes.forEach(walk);
    } else if (node.nodeType === NodeType.TEXT_NODE) {
      parts.push(node.text);
    }
  };
  walk(el);
  return parts.join("").split("\n").map(collapse).join("\n").trim();
}

/** A paragraph whose only content is one `<em>`/`<i>`. */
function isItalicOnly(el: HTMLElement): boolean {
  const kids = el.childNodes.filter((n) => isElement(n) || n.text.trim() !== "");
  return kids.length === 1 && isElement(kids[0]) && ["EM", "I"].includes(kids[0].tagName);
}

const SKIP = new Set(["SCRIPT", "STYLE", "HEAD", "TEMPLATE", "NOSCRIPT"]);

/** Splits HTML (including mammoth's DOCX output) into blocks. */
export function htmlToBlocks(html: string): ImportBlock[] {
  const blocks: ImportBlock[] = [];
  let afterHeading = false;

  const push = (block: ImportBlock) => {
    blocks.push(block);
    afterHeading = block.type === "heading";
  };

  const visit = (node: Node) => {
    if (!isElement(node)) {
      const text = collapse(node.nodeType === NodeType.TEXT_NODE ? node.text : "");
      if (text) push({ type: "paragraph", text });
      return;
    }
    const tag = node.tagName;
    if (SKIP.has(tag)) return;
    const heading = /^H([1-6])$/.exec(tag);
    if (heading) {
      const text = collapse(elementText(node));
      if (text) push({ type: "heading", level: Number(heading[1]), text });
      return;
    }
    if (tag === "HR") return push({ type: "break" });
    if (tag === "BLOCKQUOTE") {
      const paras = node.childNodes.filter(isElement).filter((c) => c.tagName === "P");
      const text = (paras.length ? paras.map(elementText) : [elementText(node)])
        .filter(Boolean)
        .join("\n\n");
      if (text) push({ type: "quote", text });
      return;
    }
    if (tag === "P" || tag === "LI" || tag === "PRE") {
      const text = elementText(node);
      if (!text) return;
      if (isSceneBreak(text)) push({ type: "break" });
      else if (node.classList.contains("subtitle") || (afterHeading && isItalicOnly(node))) {
        push({ type: "subtitle", text: collapse(text) });
      } else push({ type: "paragraph", text });
      return;
    }
    node.childNodes.forEach(visit);
  };

  visit(parse(html.replace(/^\s*<!doctype[^>]*>/i, ""), { comment: false }));
  return blocks;
}
