import { NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { duplicatePromptToLibrary, handlePromptApiError } from "@/lib/prompts";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_request: NextRequest, ctx: Ctx) {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await ctx.params;
    const prompt = await duplicatePromptToLibrary(user.id, id);
    return Response.json({ prompt }, { status: 201 });
  } catch (err) {
    return handlePromptApiError(err);
  }
}
