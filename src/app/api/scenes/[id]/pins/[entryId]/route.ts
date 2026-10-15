import { NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  handleCodexApiError,
  pinCodexEntryToScene,
  unpinCodexEntryFromScene,
} from "@/lib/codex/service";

export const dynamic = "force-dynamic";

type PinRouteContext = { params: Promise<{ id: string; entryId: string }> };

async function getUserId(): Promise<string | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

export async function PUT(_request: NextRequest, { params }: PinRouteContext) {
  try {
    const userId = await getUserId();
    if (!userId) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id, entryId } = await params;
    const pin = await pinCodexEntryToScene(userId, id, entryId);

    return Response.json({ pin }, { status: 200 });
  } catch (err) {
    return handleCodexApiError(err);
  }
}

export async function DELETE(_request: NextRequest, { params }: PinRouteContext) {
  try {
    const userId = await getUserId();
    if (!userId) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id, entryId } = await params;
    await unpinCodexEntryFromScene(userId, id, entryId);

    return new Response(null, { status: 204 });
  } catch (err) {
    return handleCodexApiError(err);
  }
}
