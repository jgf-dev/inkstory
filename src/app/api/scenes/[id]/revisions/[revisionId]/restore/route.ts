import { NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { handleCodexApiError } from "@/lib/codex/errors";
import { restoreSceneRevision } from "@/lib/writing/service";

export const dynamic = "force-dynamic";

/**
 * POST /api/scenes/:id/revisions/:revisionId/restore
 * Snapshots the live scene as RESTORE, then applies the chosen revision.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; revisionId: string }> },
) {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id, revisionId } = await params;
    const scene = await restoreSceneRevision(user.id, id, revisionId);

    return Response.json({ scene });
  } catch (err) {
    return handleCodexApiError(err);
  }
}
