import { NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { handleCodexApiError } from "@/lib/codex/errors";
import { checkpointScene, listSceneRevisions } from "@/lib/writing/service";

export const dynamic = "force-dynamic";

/**
 * GET /api/scenes/:id/revisions?limit=
 * Lists recent revision metadata (newest first). Full docs are omitted.
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
    const limitParam = request.nextUrl.searchParams.get("limit");
    const limit = limitParam ? Number(limitParam) : 20;
    const revisions = await listSceneRevisions(user.id, id, limit);

    return Response.json({ revisions });
  } catch (err) {
    return handleCodexApiError(err);
  }
}

/**
 * POST /api/scenes/:id/revisions
 * Takes a MANUAL revision of the stored scene (Craft Apply checkpoint, STO-1266).
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const revision = await checkpointScene(user.id, id);

    return Response.json({ revision }, { status: 201 });
  } catch (err) {
    return handleCodexApiError(err);
  }
}
