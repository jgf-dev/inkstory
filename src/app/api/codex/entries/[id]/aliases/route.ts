import { NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createCodexAlias, handleCodexApiError } from "@/lib/codex/service";

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
    const body = (await request.json()) as { name: string };
    const alias = await createCodexAlias(user.id, {
      entryId: id,
      name: body.name,
    });

    return Response.json({ alias }, { status: 201 });
  } catch (err) {
    return handleCodexApiError(err);
  }
}
