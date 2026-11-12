import { NextRequest } from "next/server";
import { handleCodexApiError } from "@/lib/codex/errors";
import { exportCharacterCard } from "@/lib/codex/interchange/card-service";
import { CARD_MAX_BODY_BYTES, getUserId, readJsonBody } from "@/lib/codex/interchange/http";

export const dynamic = "force-dynamic";

/**
 * POST { entryId, format?: "json" | "png", portrait?: base64 PNG }
 * → { filename, card, png?, warnings }. PNG export embeds the card in the
 * author-supplied portrait; no URL is ever fetched.
 */
export async function POST(request: NextRequest) {
  try {
    const userId = await getUserId();
    if (!userId) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    const body = await readJsonBody(request, CARD_MAX_BODY_BYTES);
    const result = await exportCharacterCard(userId, {
      entryId: body.entryId,
      format: body.format,
      portrait: body.portrait,
    });
    return Response.json(result);
  } catch (err) {
    return handleCodexApiError(err);
  }
}
