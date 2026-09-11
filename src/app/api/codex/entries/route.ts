import { NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  CodexError,
  createCodexEntry,
  listCodexEntriesForNovel,
  listCodexEntriesForSeries,
} from "@/lib/codex/service";
import type { CodexEntryFilter, CreateCodexEntryInput } from "@/lib/codex/types";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const novelId = searchParams.get("novelId");
    const seriesId = searchParams.get("seriesId");
    const type = searchParams.get("type") as CodexEntryFilter["type"];
    const trackingMode = searchParams.get("trackingMode") as CodexEntryFilter["trackingMode"];
    const search = searchParams.get("search") || undefined;
    const seriesOnly = searchParams.get("seriesOnly") === "true";

    const filter: CodexEntryFilter = {
      type: type || undefined,
      trackingMode: trackingMode || undefined,
      search,
      seriesOnly,
    };

    if (novelId) {
      const entries = await listCodexEntriesForNovel(user.id, novelId, filter);
      return Response.json({ entries });
    }

    if (seriesId) {
      const entries = await listCodexEntriesForSeries(user.id, seriesId, filter);
      return Response.json({ entries });
    }

    return Response.json(
      { error: "Must specify novelId or seriesId query parameter" },
      { status: 400 },
    );
  } catch (err) {
    if (err instanceof CodexError) {
      return Response.json({ error: err.message, code: err.code }, { status: err.status });
    }
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as CreateCodexEntryInput;
    const entry = await createCodexEntry(user.id, body);

    return Response.json({ entry }, { status: 201 });
  } catch (err) {
    if (err instanceof CodexError) {
      return Response.json({ error: err.message, code: err.code }, { status: err.status });
    }
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
