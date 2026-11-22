import { NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { handlePromptApiError, parsePortableText, previewPortableComponent } from "@/lib/prompts";

export const dynamic = "force-dynamic";

/**
 * POST /api/prompts/components/import/preview — validate a portable file and
 * report supported features + warnings. Persists nothing (STO-1275).
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
    const component = parsePortableText(await request.text());
    return Response.json({ preview: previewPortableComponent(component) });
  } catch (err) {
    return handlePromptApiError(err);
  }
}
