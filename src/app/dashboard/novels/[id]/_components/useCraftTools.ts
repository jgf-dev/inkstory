"use client";

import { useCallback, useEffect, useState } from "react";
import type { CraftToolDto } from "@/lib/craft/client";
import { apiGet, ApiRequestError } from "./api";

export interface CraftToolsState {
  tools: CraftToolDto[];
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/**
 * Loads the Craft Studio catalog from `GET /api/craft/tools` (STO-1266). The
 * panel renders whatever the server lists, so new tools need no editor change.
 */
export function useCraftTools(): CraftToolsState {
  const [tools, setTools] = useState<CraftToolDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    apiGet<{ tools?: CraftToolDto[] }>("/api/craft/tools")
      .then((res) => {
        if (active) setTools(Array.isArray(res?.tools) ? res.tools : []);
      })
      .catch((err: unknown) => {
        if (active) {
          setError(err instanceof ApiRequestError ? err.message : "Failed to load craft tools");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  return { tools, loading, error, reload };
}
