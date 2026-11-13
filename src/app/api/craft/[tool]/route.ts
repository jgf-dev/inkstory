import { NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  byokSelectionError,
  executeChat,
  handleGenerationApiError,
  platformUnconfigured,
  resolvePlatformProfile,
} from "@/lib/ai/execute";
import { prepareCraftPrompt } from "@/lib/craft";

export const dynamic = "force-dynamic";

function badRequest(error: string) {
  return Response.json({ error, code: "VALIDATION_FAILED" }, { status: 400 });
}

/**
 * POST /api/craft/:tool — runs a Craft Studio tool on a scene (STO-1266/1267).
 *
 * Body: `{ sceneId, inputs: { "craft.selection": "…", … }, content?, dryRun?,
 * credentialId?, model? }`. Inputs are validated against the tool contract
 * (422 MISSING_INPUT / VALIDATION_FAILED) before any scene lookup or spend.
 * `dryRun: true` returns the rendered prompt without calling a provider. The
 * result is never written to the manuscript: applying it is an explicit
 * author action preceded by `POST /api/scenes/:id/revisions` (MANUAL).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tool: string }> },
) {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { tool } = await params;
    const body = (await request.json()) as {
      sceneId?: unknown;
      inputs?: unknown;
      content?: unknown;
      dryRun?: unknown;
      credentialId?: string;
      model?: string;
    };

    if (typeof body.sceneId !== "string" || !body.sceneId) {
      return badRequest("Missing required string 'sceneId'");
    }
    if (body.content !== undefined && typeof body.content !== "string") {
      return badRequest("content must be a string");
    }
    if (body.dryRun !== undefined && typeof body.dryRun !== "boolean") {
      return badRequest("dryRun must be a boolean");
    }
    const byokError = byokSelectionError(body);
    if (byokError) return badRequest(byokError);

    const prepared = await prepareCraftPrompt(user.id, tool, {
      sceneId: body.sceneId,
      inputs: body.inputs,
      content: body.content,
    });
    const prompt = {
      messages: prepared.messages,
      joined: prepared.joined,
      contextSlices: prepared.contextSlices,
      maxTokens: prepared.maxTokens,
    };

    if (body.dryRun === true) {
      return Response.json({ tool: prepared.tool, output: prepared.output, prompt });
    }

    if (platformUnconfigured(body.credentialId)) {
      return Response.json(
        {
          error: "AI generation is not configured on this deployment (missing AI_GATEWAY_API_KEY)",
          code: "AI_NOT_CONFIGURED",
          tool: prepared.tool,
          prompt,
        },
        { status: 503 },
      );
    }

    const result = await executeChat(user.id, {
      messages: prepared.messages,
      credentialId: body.credentialId,
      model: body.model,
      maxTokens: prepared.maxTokens,
      platformProfile: await resolvePlatformProfile(body.credentialId),
      signal: request.signal,
    });

    return Response.json({
      tool: prepared.tool,
      text: result.text,
      model: result.model,
      applied: result.applied,
      output: prepared.output,
    });
  } catch (err) {
    return handleGenerationApiError(err);
  }
}
