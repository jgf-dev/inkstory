import { NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { exportNovel, ExportError, parseExportOptions } from "@/lib/export";

export const dynamic = "force-dynamic";

/**
 * GET /api/books/[id]/export?format=md|docx
 *
 * Optional: content=prose|summary|both, actTitles, chapterTitles, sceneTitles,
 * subtitles (true|false), actIds, chapterIds, sceneIds (comma-separated).
 * Returns the manuscript as a file download. Read-only; owner only (other users get 404).
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const options = parseExportOptions(request.nextUrl.searchParams);
    const file = await exportNovel(user.id, id, options);
    const body = typeof file.body === "string" ? file.body : new Uint8Array(file.body);

    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": file.contentType,
        "Content-Disposition": `attachment; filename="${file.filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    if (err instanceof ExportError) {
      return Response.json({ error: err.message, code: err.code }, { status: err.status });
    }
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
