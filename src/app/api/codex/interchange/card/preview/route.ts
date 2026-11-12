import { NextRequest } from "next/server";
import { handleCodexApiError } from "@/lib/codex/errors";
import { previewCharacterCard } from "@/lib/codex/interchange/card-service";
import { CARD_MAX_BODY_BYTES, getUserId, readJsonBody } from "@/lib/codex/interchange/http";

export const dynamic = "force-dynamic";

/**
 * POST { encoding: "json" | "yaml" | "png", content } → normalized preview;
 * writes nothing. For PNG, `content` is the base64 file.
 */
export async function POST(request: NextRequest) {
  try {
    if (!(await getUserId())) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    const body = await readJsonBody(request, CARD_MAX_BODY_BYTES);
    return Response.json({
      preview: previewCharacterCard({ encoding: body.encoding, content: body.content }),
    });
  } catch (err) {
    return handleCodexApiError(err);
  }
}
