import { NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { handleCodexApiError, scanMentionsInNovel, scanMentionsInScene } from "@/lib/codex/service";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as {
      text: string;
      novelId?: string;
      sceneId?: string;
    };

    if (!body.text || typeof body.text !== "string") {
      return Response.json(
        { error: "Missing required string 'text'", code: "VALIDATION_FAILED" },
        { status: 400 },
      );
    }

    if (body.sceneId) {
      const result = await scanMentionsInScene(user.id, body.sceneId, body.text);
      return Response.json(result);
    }

    if (body.novelId) {
      const result = await scanMentionsInNovel(user.id, body.novelId, body.text);
      return Response.json(result);
    }

    return Response.json(
      { error: "Must specify novelId or sceneId", code: "VALIDATION_FAILED" },
      { status: 400 },
    );
  } catch (err) {
    return handleCodexApiError(err);
  }
}
