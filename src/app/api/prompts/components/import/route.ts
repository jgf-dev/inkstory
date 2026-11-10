import { NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { handlePromptApiError, importComponent, readPortableJson } from "@/lib/prompts";

export const dynamic = "force-dynamic";

/**
 * POST /api/prompts/components/import — explicit save of a portable file as a
 * NEW component owned by the session user (STO-1275). File contents never
 * choose ownership, scope or ids.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
    const component = await importComponent(user.id, readPortableJson(await request.text()));
    return Response.json({ component }, { status: 201 });
  } catch (err) {
    return handlePromptApiError(err);
  }
}
