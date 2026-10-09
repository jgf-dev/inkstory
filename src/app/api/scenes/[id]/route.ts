import { NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { handleCodexApiError } from "@/lib/codex/errors";
import { getSceneForEditor, updateScene, type UpdateSceneInput } from "@/lib/writing/service";

export const dynamic = "force-dynamic";

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
    const scene = await getSceneForEditor(user.id, id);

    return Response.json({ scene });
  } catch (err) {
    return handleCodexApiError(err);
  }
}

/**
 * Scene autosave endpoint: content and/or metadata. `word_count` is
 * recomputed server-side whenever content changes.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const body = (await request.json()) as UpdateSceneInput;

    if (
      body.title === undefined &&
      body.content === undefined &&
      body.summary === undefined &&
      body.pov === undefined &&
      body.tense === undefined &&
      body.excludeFromAi === undefined &&
      body.label === undefined
    ) {
      return Response.json(
        { error: "Nothing to update", code: "VALIDATION_FAILED" },
        { status: 400 },
      );
    }

    const scene = await updateScene(user.id, id, body);

    return Response.json({ scene });
  } catch (err) {
    return handleCodexApiError(err);
  }
}
