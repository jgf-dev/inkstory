import { NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  getPrompt,
  handlePromptApiError,
  softDeletePrompt,
  updatePrompt,
  type UpdatePromptInput,
} from "@/lib/prompts";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, ctx: Ctx) {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await ctx.params;
    const prompt = await getPrompt(user.id, id);
    return Response.json({ prompt });
  } catch (err) {
    return handlePromptApiError(err);
  }
}

export async function PATCH(request: NextRequest, ctx: Ctx) {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await ctx.params;
    const body = (await request.json()) as UpdatePromptInput;
    const prompt = await updatePrompt(user.id, id, body);
    return Response.json({ prompt });
  } catch (err) {
    return handlePromptApiError(err);
  }
}

export async function DELETE(_request: NextRequest, ctx: Ctx) {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await ctx.params;
    await softDeletePrompt(user.id, id);
    return Response.json({ ok: true });
  } catch (err) {
    return handlePromptApiError(err);
  }
}
