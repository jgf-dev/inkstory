import mammoth from "mammoth";
import { htmlToBlocks, markdownToBlocks } from "./blocks";
import { buildManuscript } from "./structure";
import { ImportError, type ImportFormat, type ImportManuscript, type ImportOptions } from "./types";

/** Maps the export's Word styles (Title, Heading 1–3) onto the import heading levels. */
const DOCX_STYLE_MAP = [
  "p[style-name='Title'] => h1:fresh",
  "p[style-name='Subtitle'] => p.subtitle:fresh",
  "p[style-name='Heading 1'] => h2:fresh",
  "p[style-name='Heading 2'] => h3:fresh",
  "p[style-name='Heading 3'] => h4:fresh",
  "p[style-name='Heading 4'] => h5:fresh",
  "p[style-name='Quote'] => blockquote > p:fresh",
  "p[style-name='Intense Quote'] => blockquote > p:fresh",
  "p.Quote => blockquote > p:fresh",
];

/** Converts a .docx file to HTML with mammoth. Images are dropped. */
export async function docxToHtml(buffer: Buffer): Promise<string> {
  try {
    const result = await mammoth.convertToHtml(
      { buffer },
      {
        styleMap: DOCX_STYLE_MAP,
        externalFileAccess: false,
        convertImage: mammoth.images.imgElement(async () => ({ src: "" })),
      },
    );
    return result.value;
  } catch {
    throw new ImportError("Could not read the .docx file", "VALIDATION_FAILED", 400);
  }
}

/** Picks the format from an explicit value or the file name. */
export function detectFormat(filename: string, explicit?: string | null): ImportFormat {
  const raw = (explicit || filename.split(".").pop() || "").toLowerCase();
  if (raw === "md" || raw === "markdown") return "md";
  if (raw === "html" || raw === "htm") return "html";
  if (raw === "docx") return "docx";
  throw new ImportError("Unsupported format. Use .docx, .md or .html", "UNSUPPORTED_FORMAT", 415);
}

/** Parses a manuscript file into the act → chapter → scene tree. */
export async function parseManuscript(
  data: Buffer | string,
  format: ImportFormat,
  options: ImportOptions,
): Promise<ImportManuscript> {
  const text = () => (typeof data === "string" ? data : data.toString("utf8"));
  if (format === "md") return buildManuscript(markdownToBlocks(text()), options);
  if (format === "html") return buildManuscript(htmlToBlocks(text()), options);
  const buffer = typeof data === "string" ? Buffer.from(data) : data;
  return buildManuscript(htmlToBlocks(await docxToHtml(buffer)), options);
}
