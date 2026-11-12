import { NextRequest } from "next/server";
import { handleCodexApiError } from "@/lib/codex/errors";
import { exportLorebook } from "@/lib/codex/interchange/service";
import { getUserId, readJsonBody } from "@/lib/codex/interchange/http";

export const dynamic = "force-dynamic";

/** POST { entryIds: string[], name? } → { filename, lorebook, warnings }. */
export async function POST(request: NextRequest) {
  try {
    const userId = await getUserId();
    if (!userId) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    const body = await readJsonBody(request);
    const result = await exportLorebook(userId, { entryIds: body.entryIds, name: body.name });
    return Response.json(result);
  } catch (err) {
    return handleCodexApiError(err);
  }
}
