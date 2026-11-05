import { NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  createPrompt,
  handlePromptApiError,
  listPrompts,
  type CreatePromptInput,
} from "@/lib/prompts";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const mode = searchParams.get("mode") || undefined;
    const novelId = searchParams.get("novelId") || undefined;
    const includeSystem = searchParams.get("includeSystem") !== "false";

    const prompts = await listPrompts(user.id, { mode, novelId, includeSystem });
    return Response.json({ prompts });
  } catch (err) {
    return handlePromptApiError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const body = (await request.json()) as CreatePromptInput;
    const prompt = await createPrompt(user.id, body);
    return Response.json({ prompt }, { status: 201 });
  } catch (err) {
    return handlePromptApiError(err);
  }
}
