import { NextRequest } from "next/server";
import { handleCodexApiError } from "@/lib/codex/errors";
import { importCharacterCard } from "@/lib/codex/interchange/card-service";
import type { CardImportOptions } from "@/lib/codex/interchange/types";
import { CARD_MAX_BODY_BYTES, getUserId, readJsonBody } from "@/lib/codex/interchange/http";

export const dynamic = "force-dynamic";

/**
 * POST { encoding, content, novelId? | seriesId + seriesScoped,
 *        importEmbeddedBook?, bookActivationOverrides? }
 * → creates a CHARACTER entry (plus opted-in book entries) in one transaction.
 * The file is re-parsed here; a client-side preview is never trusted.
 */
export async function POST(request: NextRequest) {
  try {
    const userId = await getUserId();
    if (!userId) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    const body = await readJsonBody(request, CARD_MAX_BODY_BYTES);
    const options: CardImportOptions = {
      novelId: typeof body.novelId === "string" ? body.novelId : null,
      seriesId: typeof body.seriesId === "string" ? body.seriesId : null,
      seriesScoped: body.seriesScoped === true,
      importEmbeddedBook: body.importEmbeddedBook === true,
      bookActivationOverrides:
        body.bookActivationOverrides as CardImportOptions["bookActivationOverrides"],
    };
    const result = await importCharacterCard(
      userId,
      { encoding: body.encoding, content: body.content },
      options,
    );
    return Response.json(result, { status: 201 });
  } catch (err) {
    return handleCodexApiError(err);
  }
}
