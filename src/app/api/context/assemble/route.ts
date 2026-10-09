import { NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { parseAssembleContextBody } from "@/lib/codex/context-request";
import { assembleCodexContextForScene, handleCodexApiError } from "@/lib/codex/service";

export const dynamic = "force-dynamic";

/**
 * POST /api/context/assemble
 *
 * Returns the full `AssembledContext` for a scene + beat, the same object a
 * generation call receives, so authors and Prompt Preview can inspect it.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const parsed = parseAssembleContextBody(await request.json());
    if (!parsed.ok) {
      return Response.json({ error: parsed.error, code: "VALIDATION_FAILED" }, { status: 400 });
    }

    const context = await assembleCodexContextForScene(user.id, parsed.input);
    return Response.json(context);
  } catch (err) {
    return handleCodexApiError(err);
  }
}
