import { NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { exportComponent, handlePromptApiError } from "@/lib/prompts";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Safe ASCII filename stem derived from the component name. */
function filenameStem(name: string): string {
  const stem = name
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 60);
  return stem || "prompt-component";
}

/** GET /api/prompts/components/:id/export — portable JSON (STO-1275). */
export async function GET(_request: NextRequest, ctx: Ctx) {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await ctx.params;
    const envelope = await exportComponent(user.id, id);
    return Response.json(envelope, {
      headers: {
        "Content-Disposition": `attachment; filename="${filenameStem(envelope.component.name)}.inkstory-prompt.json"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return handlePromptApiError(err);
  }
}
