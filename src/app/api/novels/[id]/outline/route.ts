import { NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { handleCodexApiError } from "@/lib/codex/errors";
import {
  createOutlineNode,
  deleteOutlineNode,
  getNovelOutline,
  moveOutlineNode,
  renameOutlineNode,
  type MoveOutlineNodeInput,
  type OutlineKind,
  type RenameOutlineNodeInput,
} from "@/lib/writing/service";

export const dynamic = "force-dynamic";

const OUTLINE_KINDS: readonly OutlineKind[] = ["act", "chapter", "scene"];

function isOutlineKind(value: unknown): value is OutlineKind {
  return typeof value === "string" && (OUTLINE_KINDS as readonly string[]).includes(value);
}

interface OutlinePatchInput {
  kind?: OutlineKind;
  id?: string;
  title?: string;
  direction?: "up" | "down";
}

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
    const outline = await getNovelOutline(user.id, id);

    return Response.json({ outline });
  } catch (err) {
    return handleCodexApiError(err);
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
      kind?: string;
      title?: string;
      parentId?: string;
      position?: number;
    };

    if (!isOutlineKind(body.kind)) {
      return Response.json(
        { error: "kind must be one of act, chapter, scene", code: "VALIDATION_FAILED" },
        { status: 400 },
      );
    }

    const result = await createOutlineNode(user.id, id, {
      kind: body.kind,
      title: body.title,
      parentId: body.parentId,
      position: body.position,
    });

    return Response.json(result, { status: 201 });
  } catch (err) {
    return handleCodexApiError(err);
  }
}

/**
 * Outline node maintenance: rename (title) and/or reorder (direction) a
 * single node. Node ownership is always verified against the novel path.
 */
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
    const body = (await request.json()) as OutlinePatchInput;

    if (!isOutlineKind(body.kind) || typeof body.id !== "string" || !body.id) {
      return Response.json(
        { error: "PATCH requires kind (act|chapter|scene) and id", code: "VALIDATION_FAILED" },
        { status: 400 },
      );
    }
    if (body.direction !== undefined && body.direction !== "up" && body.direction !== "down") {
      return Response.json(
        { error: "direction must be 'up' or 'down'", code: "VALIDATION_FAILED" },
        { status: 400 },
      );
    }
    if (body.title === undefined && body.direction === undefined) {
      return Response.json(
        { error: "Nothing to update: provide title or direction", code: "VALIDATION_FAILED" },
        { status: 400 },
      );
    }

    let renamed: Awaited<ReturnType<typeof renameOutlineNode>> | null = null;
    let moved: Awaited<ReturnType<typeof moveOutlineNode>> | null = null;

    if (body.title !== undefined) {
      const input: RenameOutlineNodeInput = { kind: body.kind, id: body.id, title: body.title };
      renamed = await renameOutlineNode(user.id, id, input);
    }
    if (body.direction !== undefined) {
      const input: MoveOutlineNodeInput = {
        kind: body.kind,
        id: body.id,
        direction: body.direction,
      };
      moved = await moveOutlineNode(user.id, id, input);
    }

    return Response.json({ renamed, moved });
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
    const kind = request.nextUrl.searchParams.get("kind");
    const nodeId = request.nextUrl.searchParams.get("nodeId");

    if (!isOutlineKind(kind) || !nodeId) {
      return Response.json(
        { error: "DELETE requires kind (act|chapter|scene) and nodeId", code: "VALIDATION_FAILED" },
        { status: 400 },
      );
    }

    const result = await deleteOutlineNode(user.id, id, kind, nodeId);
    return Response.json(result);
  } catch (err) {
    return handleCodexApiError(err);
  }
}
