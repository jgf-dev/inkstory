import { NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { CodexError, createCodexProgression } from "@/lib/codex/service";
import type { CreateCodexProgressionInput } from "@/lib/codex/types";

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

    const body = (await request.json()) as CreateCodexProgressionInput;
    const progression = await createCodexProgression(user.id, body);

    return Response.json({ progression }, { status: 201 });
  } catch (err) {
    if (err instanceof CodexError) {
      return Response.json({ error: err.message, code: err.code }, { status: err.status });
    }
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
