"use client";

import { useCallback, useRef, useState } from "react";
import type { ContractOutput } from "@/lib/prompts/contracts";
import type { EditorSelection } from "./RichTextEditor";
import { apiPost, ApiRequestError } from "./api";

export interface CraftRunRequest {
  toolId: string;
  sceneId: string;
  inputs: Record<string, string | number | boolean>;
  /** Current (possibly unsaved) scene prose, so the tool sees what the author sees. */
  content: string;
  /** Editor range the run was made for; Replace targets exactly this range. */
  selection: EditorSelection | null;
  credentialId?: string;
  model?: string;
}

export interface CraftRunResult {
  toolId: string;
  text: string;
  model: string;
  output: ContractOutput | null;
  selection: EditorSelection | null;
}

export type CraftRunState =
  | { kind: "idle" }
  | { kind: "running"; request: CraftRunRequest }
  | { kind: "done"; request: CraftRunRequest; result: CraftRunResult }
  | { kind: "not-configured"; request: CraftRunRequest; message: string; prompt: string }
  | { kind: "error"; request: CraftRunRequest; message: string; code: string | null };

interface CraftApiSuccess {
  tool: string;
  text: string;
  model: string;
  output: ContractOutput | null;
}

/**
 * Runs a Craft tool via `POST /api/craft/:tool` and holds the transient result
 * (nothing is persisted or written to the manuscript here). A newer run or a
 * reset supersedes any response still in flight.
 */
export function useCraftRun() {
  const [state, setState] = useState<CraftRunState>({ kind: "idle" });
  const seqRef = useRef(0);

  const run = useCallback(async (request: CraftRunRequest): Promise<void> => {
    const seq = ++seqRef.current;
    setState({ kind: "running", request });
    try {
      const res = await apiPost<CraftApiSuccess>(
        `/api/craft/${encodeURIComponent(request.toolId)}`,
        {
          sceneId: request.sceneId,
          inputs: request.inputs,
          content: request.content,
          ...(request.credentialId
            ? { credentialId: request.credentialId, model: request.model?.trim() }
            : {}),
        },
      );
      if (seq !== seqRef.current) return;
      setState({
        kind: "done",
        request,
        result: {
          toolId: res.tool ?? request.toolId,
          text: typeof res.text === "string" ? res.text : "",
          model: typeof res.model === "string" ? res.model : "",
          output: res.output ?? null,
          selection: request.selection,
        },
      });
    } catch (err) {
      if (seq !== seqRef.current) return;
      if (err instanceof ApiRequestError) {
        if (err.status === 503 && err.code === "AI_NOT_CONFIGURED") {
          const body = (err.body ?? {}) as { prompt?: { joined?: unknown } };
          setState({
            kind: "not-configured",
            request,
            message: err.message,
            prompt: typeof body.prompt?.joined === "string" ? body.prompt.joined : "",
          });
          return;
        }
        setState({ kind: "error", request, message: err.message, code: err.code });
        return;
      }
      setState({ kind: "error", request, message: "Craft request failed", code: null });
    }
  }, []);

  const reset = useCallback(() => {
    seqRef.current += 1;
    setState({ kind: "idle" });
  }, []);

  return { state, run, reset };
}
