import { getEntitlements, resolveContextTokenBudget } from "@/lib/billing/entitlements";
import { NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { inspectAssembledContext } from "@/lib/codex/context-inspection";
import { parseAssembleContextBody } from "@/lib/codex/context-request";
import { assembleCodexContextForScene, handleCodexApiError } from "@/lib/codex/service";

export const dynamic = "force-dynamic";

/**
 * POST /api/context/assemble
 *
 * Returns the full `AssembledContext` for a scene + beat, the same object a
 * generation call receives, plus request-time formatted Codex telemetry.
 * Counts use the same entitlement ceiling, budgeter and formatter as Generate.
 * Original entries/meta remain unchanged; inspection.context is post-budget.
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
    const { maxContextTokens } = await getEntitlements(user.id);
    return Response.json(
      inspectAssembledContext(context, resolveContextTokenBudget(undefined, maxContextTokens)),
      {
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  } catch (err) {
    return handleCodexApiError(err);
  }
}
