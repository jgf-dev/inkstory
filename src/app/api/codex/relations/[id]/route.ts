import { NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { deleteCodexRelation, handleCodexApiError, updateCodexRelation } from "@/lib/codex/service";
import type { UpdateCodexRelationInput } from "@/lib/codex/types";

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
    const body = (await request.json()) as UpdateCodexRelationInput;
    const relation = await updateCodexRelation(user.id, id, body);

    return Response.json({ relation });
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
    const result = await deleteCodexRelation(user.id, id);

    return Response.json(result);
  } catch (err) {
    return handleCodexApiError(err);
  }
}
