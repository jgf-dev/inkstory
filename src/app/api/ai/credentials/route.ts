import { NextRequest } from "next/server";
import {
  getAuthenticatedUser,
  handleCredentialApiError,
  isAiProviderName,
  listCredentials,
  parseCredentialInput,
  upsertCredential,
  validateCredentialFields,
} from "@/lib/ai/credentials";

export const dynamic = "force-dynamic";

/**
 * GET /api/ai/credentials — list the author's BYOK credentials (hints only).
 * PUT /api/ai/credentials — create or overwrite by (provider, label).
 */
export async function GET() {
  try {
    const user = await getAuthenticatedUser();
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
    const user = await getAuthenticatedUser();
    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as Record<string, unknown>;

    if (!isAiProviderName(body.provider)) {
      return Response.json(
        {
          error: "provider must be OPENROUTER, OPENAI, ANTHROPIC, OLLAMA, or LMSTUDIO",
          code: "VALIDATION_FAILED",
        },
        { status: 400 },
      );
    }

    const validationError = validateCredentialFields(body);
    if (validationError) {
      return Response.json({ error: validationError, code: "VALIDATION_FAILED" }, { status: 400 });
    }

    const credential = await upsertCredential(user.id, {
      provider: body.provider,
      ...parseCredentialInput(body),
    });

    return Response.json({ credential });
  } catch (err) {
    return handleCredentialApiError(err);
  }
}
