import { NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createCodexTag, handleCodexApiError } from "@/lib/codex/service";

export const dynamic = "force-dynamic";

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
    const body = (await request.json()) as { name: string; color?: string | null };
    const tag = await createCodexTag(user.id, {
      entryId: id,
      name: body.name,
      color: body.color,
    });

    return Response.json({ tag }, { status: 201 });
  } catch (err) {
    return handleCodexApiError(err);
  }
}
