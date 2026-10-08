import { NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { handleCodexApiError } from "@/lib/codex/errors";
import { getSceneContextData } from "@/lib/writing/service";

export const dynamic = "force-dynamic";

/**
 * Everything the Scene Context drawer renders: pinned attachments,
 * ALWAYS-tracked entries, detected mentions, and a live assembly estimate.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const data = await getSceneContextData(user.id, id);

    return Response.json(data);
  } catch (err) {
    return handleCodexApiError(err);
  }
}
