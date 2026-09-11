"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  CodexError,
  createCodexAlias,
  createCodexEntry,
  createCodexProgression,
  createCodexRelation,
  createCodexTag,
  deleteCodexAlias,
  deleteCodexEntry,
  deleteCodexProgression,
  deleteCodexRelation,
  deleteCodexTag,
  getCodexEntry,
  listCodexEntriesForNovel,
  listCodexEntriesForSeries,
  scanMentionsInNovel,
  scanMentionsInScene,
  updateCodexEntry,
  updateCodexProgression,
  updateCodexRelation,
} from "./service";
import type {
  CodexEntryFilter,
  CreateCodexAliasInput,
  CreateCodexEntryInput,
  CreateCodexProgressionInput,
  CreateCodexRelationInput,
  CreateCodexTagInput,
  UpdateCodexEntryInput,
  UpdateCodexProgressionInput,
  UpdateCodexRelationInput,
} from "./types";

export type ActionResult<T> =
  | { success: true; data: T; error?: never }
  | { success: false; error: string; code: string; status: number; data?: never };

async function getAuthenticatedUserId(): Promise<string> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new CodexError("You must be logged in to perform this action", "FORBIDDEN", 401);
  }

  return user.id;
}

function handleActionError(err: unknown): ActionResult<never> {
  if (err instanceof CodexError) {
    return {
      success: false,
      error: err.message,
      code: err.code,
      status: err.status,
    };
  }
  const message = err instanceof Error ? err.message : "An unexpected error occurred";
  return {
    success: false,
    error: message,
    code: "INTERNAL_ERROR",
    status: 500,
  };
}

// ─── Entry Actions ───────────────────────────────────────────────────────────

export async function createCodexEntryAction(
  input: CreateCodexEntryInput,
): Promise<ActionResult<Awaited<ReturnType<typeof createCodexEntry>>>> {
  try {
    const userId = await getAuthenticatedUserId();
    const data = await createCodexEntry(userId, input);
    return { success: true, data };
  } catch (err) {
    return handleActionError(err);
  }
}

export async function getCodexEntryAction(
  id: string,
): Promise<ActionResult<Awaited<ReturnType<typeof getCodexEntry>>>> {
  try {
    const userId = await getAuthenticatedUserId();
    const data = await getCodexEntry(userId, id);
    return { success: true, data };
  } catch (err) {
    return handleActionError(err);
  }
}

export async function updateCodexEntryAction(
  id: string,
  input: UpdateCodexEntryInput,
): Promise<ActionResult<Awaited<ReturnType<typeof updateCodexEntry>>>> {
  try {
    const userId = await getAuthenticatedUserId();
    const data = await updateCodexEntry(userId, id, input);
    return { success: true, data };
  } catch (err) {
    return handleActionError(err);
  }
}

export async function deleteCodexEntryAction(
  id: string,
  hardDelete = false,
): Promise<ActionResult<Awaited<ReturnType<typeof deleteCodexEntry>>>> {
  try {
    const userId = await getAuthenticatedUserId();
    const data = await deleteCodexEntry(userId, id, hardDelete);
    return { success: true, data };
  } catch (err) {
    return handleActionError(err);
  }
}

export async function listCodexEntriesForNovelAction(
  novelId: string,
  filter?: CodexEntryFilter,
): Promise<ActionResult<Awaited<ReturnType<typeof listCodexEntriesForNovel>>>> {
  try {
    const userId = await getAuthenticatedUserId();
    const data = await listCodexEntriesForNovel(userId, novelId, filter);
    return { success: true, data };
  } catch (err) {
    return handleActionError(err);
  }
}

export async function listCodexEntriesForSeriesAction(
  seriesId: string,
  filter?: CodexEntryFilter,
): Promise<ActionResult<Awaited<ReturnType<typeof listCodexEntriesForSeries>>>> {
  try {
    const userId = await getAuthenticatedUserId();
    const data = await listCodexEntriesForSeries(userId, seriesId, filter);
    return { success: true, data };
  } catch (err) {
    return handleActionError(err);
  }
}

// ─── Alias Actions ───────────────────────────────────────────────────────────

export async function createCodexAliasAction(
  input: CreateCodexAliasInput,
): Promise<ActionResult<Awaited<ReturnType<typeof createCodexAlias>>>> {
  try {
    const userId = await getAuthenticatedUserId();
    const data = await createCodexAlias(userId, input);
    return { success: true, data };
  } catch (err) {
    return handleActionError(err);
  }
}

export async function deleteCodexAliasAction(
  aliasId: string,
): Promise<ActionResult<Awaited<ReturnType<typeof deleteCodexAlias>>>> {
  try {
    const userId = await getAuthenticatedUserId();
    const data = await deleteCodexAlias(userId, aliasId);
    return { success: true, data };
  } catch (err) {
    return handleActionError(err);
  }
}

// ─── Tag Actions ─────────────────────────────────────────────────────────────

export async function createCodexTagAction(
  input: CreateCodexTagInput,
): Promise<ActionResult<Awaited<ReturnType<typeof createCodexTag>>>> {
  try {
    const userId = await getAuthenticatedUserId();
    const data = await createCodexTag(userId, input);
    return { success: true, data };
  } catch (err) {
    return handleActionError(err);
  }
}

export async function deleteCodexTagAction(
  tagId: string,
): Promise<ActionResult<Awaited<ReturnType<typeof deleteCodexTag>>>> {
  try {
    const userId = await getAuthenticatedUserId();
    const data = await deleteCodexTag(userId, tagId);
    return { success: true, data };
  } catch (err) {
    return handleActionError(err);
  }
}

// ─── Relation Actions ────────────────────────────────────────────────────────

export async function createCodexRelationAction(
  input: CreateCodexRelationInput,
): Promise<ActionResult<Awaited<ReturnType<typeof createCodexRelation>>>> {
  try {
    const userId = await getAuthenticatedUserId();
    const data = await createCodexRelation(userId, input);
    return { success: true, data };
  } catch (err) {
    return handleActionError(err);
  }
}

export async function updateCodexRelationAction(
  relationId: string,
  input: UpdateCodexRelationInput,
): Promise<ActionResult<Awaited<ReturnType<typeof updateCodexRelation>>>> {
  try {
    const userId = await getAuthenticatedUserId();
    const data = await updateCodexRelation(userId, relationId, input);
    return { success: true, data };
  } catch (err) {
    return handleActionError(err);
  }
}

export async function deleteCodexRelationAction(
  relationId: string,
): Promise<ActionResult<Awaited<ReturnType<typeof deleteCodexRelation>>>> {
  try {
    const userId = await getAuthenticatedUserId();
    const data = await deleteCodexRelation(userId, relationId);
    return { success: true, data };
  } catch (err) {
    return handleActionError(err);
  }
}

// ─── Progression Actions ─────────────────────────────────────────────────────

export async function createCodexProgressionAction(
  input: CreateCodexProgressionInput,
): Promise<ActionResult<Awaited<ReturnType<typeof createCodexProgression>>>> {
  try {
    const userId = await getAuthenticatedUserId();
    const data = await createCodexProgression(userId, input);
    return { success: true, data };
  } catch (err) {
    return handleActionError(err);
  }
}

export async function updateCodexProgressionAction(
  progressionId: string,
  input: UpdateCodexProgressionInput,
): Promise<ActionResult<Awaited<ReturnType<typeof updateCodexProgression>>>> {
  try {
    const userId = await getAuthenticatedUserId();
    const data = await updateCodexProgression(userId, progressionId, input);
    return { success: true, data };
  } catch (err) {
    return handleActionError(err);
  }
}

export async function deleteCodexProgressionAction(
  progressionId: string,
): Promise<ActionResult<Awaited<ReturnType<typeof deleteCodexProgression>>>> {
  try {
    const userId = await getAuthenticatedUserId();
    const data = await deleteCodexProgression(userId, progressionId);
    return { success: true, data };
  } catch (err) {
    return handleActionError(err);
  }
}

// ─── Mention Detection Action ────────────────────────────────────────────────

export async function detectMentionsAction(params: {
  text: string;
  novelId?: string;
  sceneId?: string;
}): Promise<ActionResult<Awaited<ReturnType<typeof scanMentionsInNovel>>>> {
  try {
    const userId = await getAuthenticatedUserId();
    if (params.sceneId) {
      const data = await scanMentionsInScene(userId, params.sceneId, params.text);
      return { success: true, data };
    }
    if (params.novelId) {
      const data = await scanMentionsInNovel(userId, params.novelId, params.text);
      return { success: true, data };
    }
    return {
      success: false,
      error: "Must provide either novelId or sceneId",
      code: "VALIDATION_FAILED",
      status: 400,
    };
  } catch (err) {
    return handleActionError(err);
  }
}
