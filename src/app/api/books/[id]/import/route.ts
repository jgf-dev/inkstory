import { NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  assertNovelOwner,
  detectFormat,
  importManuscript,
  ImportError,
  MAX_IMPORT_BYTES,
  parseManuscript,
  previewManuscript,
} from "@/lib/import";

export const dynamic = "force-dynamic";

const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

function field(form: FormData, name: string): string | null {
  const value = form.get(name);
  return typeof value === "string" ? value : null;
}

/**
 * POST /api/books/[id]/import (multipart/form-data)
 *
 * Fields: `file` (.docx, .md or .html), optional `format` (md|html|docx),
 * `summaries` (true|false, default true: blockquotes become scene summaries)
 * and `confirm` (true|false, default false).
 *
 * Without `confirm=true` nothing is written: the response is the structure and
 * word-count preview. With it, the acts are appended to the book and the
 * response is 201. Owner only (other users get 404).
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { id } = await params;
    await assertNovelOwner(user.id, id);

    // Reject oversized uploads before buffering the multipart body. The
    // allowance covers multipart boundaries and the small text fields.
    const declared = Number(request.headers.get("content-length") ?? "");
    if (Number.isFinite(declared) && declared > MAX_IMPORT_BYTES + MULTIPART_OVERHEAD_BYTES) {
      throw new ImportError("File is too large (10 MB max)", "VALIDATION_FAILED", 413);
    }

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      throw new ImportError("Expected multipart/form-data", "VALIDATION_FAILED", 400);
    }
    const file = form.get("file");
    if (!(file instanceof Blob)) {
      throw new ImportError("Missing file", "VALIDATION_FAILED", 400);
    }
    if (file.size > MAX_IMPORT_BYTES) {
      throw new ImportError("File is too large (10 MB max)", "VALIDATION_FAILED", 413);
    }
    const name = "name" in file && typeof file.name === "string" ? file.name : "";
    const format = detectFormat(name, field(form, "format"));
    const summaries = field(form, "summaries") !== "false";
    const confirm = field(form, "confirm") === "true";

    const manuscript = await parseManuscript(Buffer.from(await file.arrayBuffer()), format, {
      summaries,
    });
    if (!confirm) {
      return Response.json({ preview: previewManuscript(manuscript) }, { status: 200 });
    }
    const result = await importManuscript(user.id, id, manuscript);
    return Response.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof ImportError) {
      return Response.json({ error: err.message, code: err.code }, { status: err.status });
    }
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
