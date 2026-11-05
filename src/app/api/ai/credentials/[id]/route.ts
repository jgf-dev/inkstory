import { NextRequest } from "next/server";
import {
  getAuthenticatedUser,
  getCredential,
  handleCredentialApiError,
  parseCredentialInput,
  patchCredential,
  softDeleteCredential,
  validateCredentialFields,
} from "@/lib/ai/credentials";

export const dynamic = "force-dynamic";

/**
 * GET /api/ai/credentials/:id — single credential DTO (hint only).
 * PATCH /api/ai/credentials/:id — update label / key / baseUrl.
 * DELETE /api/ai/credentials/:id — soft-delete.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthenticatedUser();
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
    const user = await getAuthenticatedUser();
    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const body = (await request.json()) as Record<string, unknown>;

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

    const validationError = validateCredentialFields(body);
    if (validationError) {
      return Response.json({ error: validationError, code: "VALIDATION_FAILED" }, { status: 400 });
    }

    const credential = await patchCredential(user.id, id, parseCredentialInput(body));

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
    const user = await getAuthenticatedUser();
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
