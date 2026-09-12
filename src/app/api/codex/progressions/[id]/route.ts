import { NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  deleteCodexProgression,
  handleCodexApiError,
  updateCodexProgression,
} from "@/lib/codex/service";
import type { UpdateCodexProgressionInput } from "@/lib/codex/types";

export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const body = (await request.json()) as UpdateCodexProgressionInput;
    const progression = await updateCodexProgression(user.id, id, body);

    return Response.json({ progression });
  } catch (err) {
    return handleCodexApiError(err);
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const result = await deleteCodexProgression(user.id, id);

    return Response.json(result);
  } catch (err) {
    return handleCodexApiError(err);
  }
}
