import { NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  getCredential,
  handleCredentialApiError,
  patchCredential,
  softDeleteCredential,
} from "@/lib/ai/credentials";

export const dynamic = "force-dynamic";

/**
 * GET /api/ai/credentials/:id — single credential DTO (hint only).
 * PATCH /api/ai/credentials/:id — update label / key / baseUrl.
 * DELETE /api/ai/credentials/:id — soft-delete.
 */
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
    const credential = await getCredential(user.id, id);
    return Response.json({ credential });
  } catch (err) {
    return handleCredentialApiError(err);
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
    const body = (await request.json()) as {
      label?: unknown;
      apiKey?: unknown;
      baseUrl?: unknown;
      defaultModel?: unknown;
      defaultTemp?: unknown;
    };

    if (
      body.label === undefined &&
      body.apiKey === undefined &&
      body.baseUrl === undefined &&
      body.defaultModel === undefined &&
      body.defaultTemp === undefined
    ) {
      return Response.json(
        { error: "Nothing to update", code: "VALIDATION_FAILED" },
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

    const credential = await patchCredential(user.id, id, {
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
    const result = await softDeleteCredential(user.id, id);
    return Response.json(result);
  } catch (err) {
    return handleCredentialApiError(err);
  }
}
