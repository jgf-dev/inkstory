import { NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { assembleSceneContext, handleCodexApiError } from "@/lib/codex/service";

export const dynamic = "force-dynamic";

/**
 * POST /api/codex/assemble-context
 *
 * Assembles ranked, token-budgeted Codex context for a scene and returns both
 * the structured context and the formatted `<codex_context>` XML prompt block.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as {
      sceneId?: unknown;
      beatText?: unknown;
      recentProse?: unknown;
      manualAttachmentIds?: unknown;
      options?: {
        maxEntries?: unknown;
        maxRelationDepth?: unknown;
        includeSeriesCodex?: unknown;
        maxTokens?: unknown;
      };
    };

    if (!body.sceneId || typeof body.sceneId !== "string") {
      return Response.json(
        { error: "Missing required string 'sceneId'", code: "VALIDATION_FAILED" },
        { status: 400 },
      );
    }

    for (const [field, value] of [
      ["beatText", body.beatText],
      ["recentProse", body.recentProse],
    ] as const) {
      if (value !== undefined && typeof value !== "string") {
        return Response.json(
          { error: `Field '${field}' must be a string`, code: "VALIDATION_FAILED" },
          { status: 400 },
        );
      }
    }

    if (
      body.manualAttachmentIds !== undefined &&
      (!Array.isArray(body.manualAttachmentIds) ||
        body.manualAttachmentIds.some((id) => typeof id !== "string"))
    ) {
      return Response.json(
        {
          error: "Field 'manualAttachmentIds' must be an array of strings",
          code: "VALIDATION_FAILED",
        },
        { status: 400 },
      );
    }

    if (body.options !== undefined && (body.options === null || typeof body.options !== "object")) {
      return Response.json(
        { error: "Field 'options' must be an object", code: "VALIDATION_FAILED" },
        { status: 400 },
      );
    }

    for (const field of ["maxEntries", "maxRelationDepth", "maxTokens"] as const) {
      const value = body.options?.[field];
      if (
        value !== undefined &&
        (typeof value !== "number" || !Number.isFinite(value) || value < 0)
      ) {
        return Response.json(
          { error: `Option '${field}' must be a non-negative number`, code: "VALIDATION_FAILED" },
          { status: 400 },
        );
      }
    }

    if (
      body.options?.includeSeriesCodex !== undefined &&
      typeof body.options.includeSeriesCodex !== "boolean"
    ) {
      return Response.json(
        { error: "Option 'includeSeriesCodex' must be a boolean", code: "VALIDATION_FAILED" },
        { status: 400 },
      );
    }

    const result = await assembleSceneContext(user.id, {
      sceneId: body.sceneId,
      beatText: body.beatText as string | undefined,
      recentProse: body.recentProse as string | undefined,
      manualAttachmentIds: body.manualAttachmentIds as string[] | undefined,
      options: body.options as {
        maxEntries?: number;
        maxRelationDepth?: number;
        includeSeriesCodex?: boolean;
        maxTokens?: number;
      },
    });

    return Response.json(result);
  } catch (err) {
    return handleCodexApiError(err);
  }
}
