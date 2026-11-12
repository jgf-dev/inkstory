import { NextRequest } from "next/server";
import { handleCodexApiError } from "@/lib/codex/errors";
import { previewLorebookImport } from "@/lib/codex/interchange/service";
import { getUserId, readJsonBody } from "@/lib/codex/interchange/http";

export const dynamic = "force-dynamic";

/** POST { content: "<lorebook JSON text>" } → normalized preview; writes nothing. */
export async function POST(request: NextRequest) {
  try {
    if (!(await getUserId())) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    const body = await readJsonBody(request);
    return Response.json({ preview: previewLorebookImport(body.content) });
  } catch (err) {
    return handleCodexApiError(err);
  }
}
