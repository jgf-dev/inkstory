import { NextRequest } from "next/server";
import { handleCodexApiError } from "@/lib/codex/errors";
import { importLorebook } from "@/lib/codex/interchange/service";
import type { LorebookImportOptions } from "@/lib/codex/interchange/types";
import { getUserId, readJsonBody } from "@/lib/codex/interchange/http";

export const dynamic = "force-dynamic";

/**
 * POST { content, novelId? | seriesId + seriesScoped, type?, activationOverrides? }
 * → creates new Codex entries in one transaction. The file is re-parsed here;
 * a client-side preview is never trusted.
 */
export async function POST(request: NextRequest) {
  try {
    const userId = await getUserId();
    if (!userId) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    const body = await readJsonBody(request);
    const options: LorebookImportOptions = {
      novelId: typeof body.novelId === "string" ? body.novelId : null,
      seriesId: typeof body.seriesId === "string" ? body.seriesId : null,
      seriesScoped: body.seriesScoped === true,
      type: body.type as LorebookImportOptions["type"],
      activationOverrides: body.activationOverrides as LorebookImportOptions["activationOverrides"],
    };
    const result = await importLorebook(userId, body.content, options);
    return Response.json(result, { status: 201 });
  } catch (err) {
    return handleCodexApiError(err);
  }
}
