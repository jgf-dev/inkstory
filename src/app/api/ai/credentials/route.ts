import { NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  handleCredentialApiError,
  isAiProviderName,
  listCredentials,
  upsertCredential,
} from "@/lib/ai/credentials";

export const dynamic = "force-dynamic";

/**
 * GET /api/ai/credentials — list the author's BYOK credentials (hints only).
 * PUT /api/ai/credentials — create or overwrite by (provider, label).
 */
export async function GET() {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const credentials = await listCredentials(user.id);
    return Response.json({ credentials });
  } catch (err) {
    return handleCredentialApiError(err);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as {
      provider?: unknown;
      label?: unknown;
      apiKey?: unknown;
      baseUrl?: unknown;
      defaultModel?: unknown;
      defaultTemp?: unknown;
    };

    if (!isAiProviderName(body.provider)) {
      return Response.json(
        {
          error: "provider must be OPENROUTER, OPENAI, ANTHROPIC, OLLAMA, or LMSTUDIO",
          code: "VALIDATION_FAILED",
        },
        { status: 400 },
      );
    }
    if (body.label !== undefined && typeof body.label !== "string") {
      return Response.json(
        { error: "label must be a string", code: "VALIDATION_FAILED" },
        { status: 400 },
      );
    }
    if (body.apiKey !== undefined && body.apiKey !== null && typeof body.apiKey !== "string") {
      return Response.json(
        { error: "apiKey must be a string", code: "VALIDATION_FAILED" },
        { status: 400 },
      );
    }
    if (body.baseUrl !== undefined && body.baseUrl !== null && typeof body.baseUrl !== "string") {
      return Response.json(
        { error: "baseUrl must be a string", code: "VALIDATION_FAILED" },
        { status: 400 },
      );
    }

    const credential = await upsertCredential(user.id, {
      provider: body.provider,
      label: typeof body.label === "string" ? body.label : undefined,
      apiKey:
        typeof body.apiKey === "string" ? body.apiKey : body.apiKey === null ? null : undefined,
      baseUrl:
        typeof body.baseUrl === "string" ? body.baseUrl : body.baseUrl === null ? null : undefined,
      defaultModel:
        typeof body.defaultModel === "string"
          ? body.defaultModel
          : body.defaultModel === null
            ? null
            : undefined,
      defaultTemp:
        typeof body.defaultTemp === "number"
          ? body.defaultTemp
          : body.defaultTemp === null
            ? null
            : undefined,
    });

    return Response.json({ credential });
  } catch (err) {
    return handleCredentialApiError(err);
  }
}
