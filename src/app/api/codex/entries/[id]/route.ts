import { NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  deleteCodexEntry,
  getCodexEntry,
  handleCodexApiError,
  updateCodexEntry,
} from "@/lib/codex/service";
import type { UpdateCodexEntryInput } from "@/lib/codex/types";

export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const entry = await getCodexEntry(user.id, id);

    return Response.json({ entry });
  } catch (err) {
    return handleCodexApiError(err);
  }
}

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
    const body = (await request.json()) as UpdateCodexEntryInput;
    const entry = await updateCodexEntry(user.id, id, body);

    return Response.json({ entry });
  } catch (err) {
    return handleCodexApiError(err);
  }
}

export async function DELETE(
  request: NextRequest,
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
    const hardDelete = request.nextUrl.searchParams.get("hard") === "true";
    const result = await deleteCodexEntry(user.id, id, hardDelete);

    return Response.json(result);
  } catch (err) {
    return handleCodexApiError(err);
  }
}
