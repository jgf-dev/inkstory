import { NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { handleCodexApiError } from "@/lib/codex/errors";
import { setSceneAttachment } from "@/lib/writing/service";

export const dynamic = "force-dynamic";

/**
 * Quick-toggle endpoint for scene codex attachments. `attach: true` pins an
 * entry (always seeded into assembly for this scene), `attach: false` unpins.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const body = (await request.json()) as { entryId?: string; attach?: boolean };

    if (typeof body.entryId !== "string" || !body.entryId || typeof body.attach !== "boolean") {
      return Response.json(
        { error: "POST requires entryId (string) and attach (boolean)", code: "VALIDATION_FAILED" },
        { status: 400 },
      );
    }

    const result = await setSceneAttachment(user.id, id, body.entryId, body.attach);

    return Response.json(result);
  } catch (err) {
    return handleCodexApiError(err);
  }
}
