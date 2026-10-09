"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { CodexError } from "@/lib/codex/errors";
import {
  createNovel,
  createSeries,
  seedStarterBible,
  type CreateNovelInput,
  type CreateSeriesInput,
} from "./service";

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

export async function createNovelAction(
  input: CreateNovelInput,
): Promise<ActionResult<Awaited<ReturnType<typeof createNovel>>>> {
  try {
    const userId = await getAuthenticatedUserId();
    const data = await createNovel(userId, input);
    return { success: true, data: JSON.parse(JSON.stringify(data)) };
  } catch (err) {
    return handleActionError(err);
  }
}

export async function createSeriesAction(
  input: CreateSeriesInput,
): Promise<ActionResult<Awaited<ReturnType<typeof createSeries>>>> {
  try {
    const userId = await getAuthenticatedUserId();
    const data = await createSeries(userId, input);
    return { success: true, data: JSON.parse(JSON.stringify(data)) };
  } catch (err) {
    return handleActionError(err);
  }
}

export async function seedStarterBibleAction(): Promise<
  ActionResult<Awaited<ReturnType<typeof seedStarterBible>>>
> {
  try {
    const userId = await getAuthenticatedUserId();
    const data = await seedStarterBible(userId);
    return { success: true, data: JSON.parse(JSON.stringify(data)) };
  } catch (err) {
    return handleActionError(err);
  }
}
