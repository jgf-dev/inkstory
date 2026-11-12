"use client";

import { useEffect, useState } from "react";
import type { GenerationMode } from "@/lib/ai/generate";
import type { CredentialDto } from "@/lib/ai/credentials/service";
import type { AppliedGenerationMetadata } from "@/lib/ai/capabilities/applied";
import type { CapabilitySummary } from "@/lib/ai/capabilities/resolve";
import {
  AVAILABILITY_LABELS,
  describeApplied,
  parseMinPDraft,
} from "@/lib/ai/capabilities/display";
import { apiGet, apiPost, ApiRequestError } from "./api";

export interface AiAssistantDrawerProps {
  sceneId: string;
  /** Current (possibly unsaved) scene prose, used for prompt freshness. */
  content: string;
  onClose: () => void;
  onInsertText: (text: string) => void;
}

interface PromptPreview {
  system: string;
  user: string;
}

interface GenerateSuccess {
  text: string;
  model: string;
  applied?: AppliedGenerationMetadata;
}

interface PreviewResult {
  messages: Array<{ role: "system" | "user"; content: string }>;
  joined: string;
  unresolved: string[];
  unknownTokens: string[];
  prompt: { id: string; name: string; scope: string; mode: string };
}

type GenerateOutcome =
  | { kind: "generated"; result: GenerateSuccess }
  | { kind: "not-configured"; prompt: PromptPreview; message: string }
  | { kind: "preview"; result: PreviewResult };

const MODE_LABELS: Record<GenerationMode, string> = {
  continuation: "Continue scene",
  beat_expansion: "Expand beat",
};

/**
 * AI Assistant drawer (launch phase 3): generates scene continuations or beat
 * expansions from the assembled Codex context. Without a configured gateway
 * the drawer degrades gracefully to a copyable prompt builder (503
 * `AI_NOT_CONFIGURED` still returns the assembled prompt).
 */
export function AiAssistantDrawer({
  sceneId,
  content,
  onClose,
  onInsertText,
}: AiAssistantDrawerProps) {
  const [mode, setMode] = useState<GenerationMode>("continuation");
  const [beatText, setBeatText] = useState("");
  const [outcome, setOutcome] = useState<GenerateOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  /** Author-editable copy of the latest generation (STO-1174). */
  const [draft, setDraft] = useState("");
  const [accepted, setAccepted] = useState(false);

  const [credentials, setCredentials] = useState<CredentialDto[]>([]);
  const [credentialsError, setCredentialsError] = useState(false);
  const [credentialId, setCredentialId] = useState("");
  const [model, setModel] = useState("");

  /** STO-1265 advanced controls (per request; nothing persisted). */
  const [avoidanceGuidance, setAvoidanceGuidance] = useState("");
  const [minPDraft, setMinPDraft] = useState("");
  const [capabilities, setCapabilities] = useState<CapabilitySummary | null>(null);

  useEffect(() => {
    if (credentialId && !model.trim()) {
      setCapabilities(null);
      return;
    }
    let active = true;
    const query = credentialId
      ? `?${new URLSearchParams({ credentialId, model: model.trim() }).toString()}`
      : "";
    const timer = setTimeout(() => {
      apiGet<{ capabilities?: CapabilitySummary }>(`/api/ai/capabilities${query}`)
        .then((result) => {
          if (active) setCapabilities(result?.capabilities ?? null);
        })
        .catch(() => {
          if (active) setCapabilities(null);
        });
    }, 300);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [credentialId, model]);

  const minPCapability = capabilities?.usable.find((c) => c.id === "minP") ?? null;
  const minPValue = parseMinPDraft(minPDraft);
  const minPInvalid = minPDraft.trim() !== "" && minPValue === null;
  /** Untouched (empty) Min-P is omitted — never sent as 0. */
  const sendMinP = minPCapability && minPValue !== null ? minPValue : undefined;
  const guidance = avoidanceGuidance.trim() || undefined;

  useEffect(() => {
    let active = true;
    apiGet<{ credentials: CredentialDto[] }>("/api/ai/credentials")
      .then((result) => {
        if (active) {
          setCredentials(Array.isArray(result.credentials) ? result.credentials : []);
        }
      })
      .catch(() => {
        if (active) setCredentialsError(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const canGenerate =
    !busy && (!credentialId || Boolean(model.trim())) && !(minPCapability && minPInvalid);

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const res = await apiPost<GenerateSuccess & { prompt?: PromptPreview; code?: string }>(
        "/api/ai/generate",
        {
          sceneId,
          mode,
          beatText: beatText || undefined,
          content,
          ...(credentialId ? { credentialId, model: model.trim() } : {}),
          ...(guidance ? { avoidanceGuidance: guidance } : {}),
          ...(sendMinP !== undefined ? { minP: sendMinP } : {}),
        },
      );
      setOutcome({
        kind: "generated",
        result: { text: res.text, model: res.model, applied: res.applied },
      });
      setDraft(res.text);
      setAccepted(false);
    } catch (err) {
      if (err instanceof ApiRequestError) {
        if (err.status === 503 && err.code === "AI_NOT_CONFIGURED") {
          const body = (err.body ?? {}) as { prompt?: PromptPreview };
          setOutcome({
            kind: "not-configured",
            prompt: body.prompt ?? { system: "", user: "" },
            message: err.message,
          });
        } else {
          setError(err.message);
        }
      } else {
        setError("Generation failed");
      }
    } finally {
      setBusy(false);
    }
  }

  async function preview() {
    setBusy(true);
    setError(null);
    try {
      const res = await apiPost<PreviewResult>("/api/ai/preview", {
        sceneId,
        mode,
        beatText: beatText || undefined,
        content,
        ...(guidance ? { avoidanceGuidance: guidance } : {}),
      });
      setOutcome({ kind: "preview", result: res });
      setAccepted(false);
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(err.message);
      } else {
        setError("Preview failed");
      }
    } finally {
      setBusy(false);
    }
  }

  async function copy(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      setError("Copy failed — select the text manually.");
    }
  }

  function accept() {
    if (!draft.trim()) return;
    onInsertText(draft);
    setOutcome(null);
    setDraft("");
    setError(null);
    setAccepted(true);
  }

  function discard() {
    setOutcome(null);
    setDraft("");
    setError(null);
    setAccepted(false);
  }

  const edited = outcome?.kind === "generated" && draft !== outcome.result.text;

  const promptPreview: PromptPreview | null =
    outcome?.kind === "not-configured" ? outcome.prompt : null;

  return (
    <div className="flex h-full flex-col" data-testid="ai-assistant-drawer">
      <header className="border-ink-200 flex items-center justify-between border-b px-4 py-3">
        <h2 className="text-sm font-semibold text-ink-900">AI Assistant</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close AI assistant drawer"
          className="rounded px-2 py-1 text-xs text-ink-500 hover:bg-ink-100"
        >
          ✕
        </button>
      </header>

      <div className="border-ink-200 space-y-3 border-b px-4 py-3">
        <label className="block text-xs text-muted">
          Generation provider
          <select
            aria-label="Generation provider"
            value={credentialId}
            disabled={busy}
            onChange={(event) => {
              setCredentialId(event.target.value);
              setModel("");
            }}
            className="mt-1 w-full rounded border border-subtle bg-card p-2 text-primary"
          >
            <option value="">Platform gateway (default)</option>
            {credentials.map((credential) => (
              <option key={credential.id} value={credential.id}>
                {credential.provider} — {credential.label || "Default"} {credential.keyHint ?? ""}
              </option>
            ))}
          </select>
        </label>
        {credentialsError && (
          <p role="status" className="text-xs text-muted">
            Saved credentials could not be loaded. Platform gateway is still available; reopen this
            drawer to retry.
          </p>
        )}
        {credentialId && (
          <label className="block text-xs text-muted">
            Provider model ID
            <input
              aria-label="Provider model ID"
              value={model}
              maxLength={256}
              disabled={busy}
              onChange={(event) => setModel(event.target.value)}
              placeholder="Enter a model ID supported by this provider"
              className="mt-1 w-full rounded border border-subtle bg-card p-2 text-primary"
            />
            Uses your selected credential, not platform credits.
          </label>
        )}
        <div className="flex gap-1" role="tablist" aria-label="Generation mode">
          {(Object.keys(MODE_LABELS) as GenerationMode[]).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={mode === value}
              onClick={() => setMode(value)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                mode === value
                  ? "bg-ink-800 text-ink-50"
                  : "bg-ink-100 text-ink-600 hover:bg-ink-200"
              }`}
            >
              {MODE_LABELS[value]}
            </button>
          ))}
        </div>

        <label className="block">
          <span className="text-ink-500 block text-xs font-medium">
            {mode === "beat_expansion" ? "Beat to expand" : "Beat hint (optional)"}
          </span>
          <textarea
            value={beatText}
            onChange={(e) => setBeatText(e.target.value)}
            rows={3}
            placeholder={
              mode === "beat_expansion"
                ? "e.g. Mara confronts the harbormaster about the missing shipment"
                : "Optional direction, e.g. keep it tense, end on a decision"
            }
            className="border-ink-300 mt-1 w-full rounded-md border bg-white px-2 py-1.5 text-sm text-ink-900"
          />
        </label>

        <details className="text-xs text-muted" data-testid="ai-advanced-controls">
          <summary className="cursor-pointer font-medium">Advanced controls</summary>
          <div className="mt-2 space-y-2">
            <label className="block">
              Avoidance / anti-trope guidance (instructions)
              <textarea
                aria-label="Avoidance / anti-trope guidance (instructions)"
                value={avoidanceGuidance}
                maxLength={4000}
                rows={2}
                disabled={busy}
                onChange={(e) => setAvoidanceGuidance(e.target.value)}
                placeholder="e.g. avoid clichés like 'a breath she didn't know she was holding'"
                className="mt-1 w-full rounded border border-subtle bg-card p-2 text-primary"
              />
              Included in the prompt. The model may not follow every preference; this is not a hard
              ban.
            </label>
            {minPCapability && (
              <label className="block">
                Min-P (0–1)
                <input
                  aria-label="Min-P"
                  type="number"
                  min={0}
                  max={1}
                  step={0.01}
                  value={minPDraft}
                  disabled={busy}
                  onChange={(e) => setMinPDraft(e.target.value)}
                  placeholder="Leave empty to not send Min-P"
                  className="mt-1 w-full rounded border border-subtle bg-card p-2 text-primary"
                />
                {minPInvalid ? "Min-P must be a number from 0 to 1." : minPCapability.reason}
              </label>
            )}
            {!minPCapability && minPDraft.trim() !== "" && (
              <p role="status">
                Min-P is set but unavailable for this model, so it will not be sent.
              </p>
            )}
            {capabilities && capabilities.unavailable.length > 0 && (
              <details data-testid="ai-unavailable-controls">
                <summary className="cursor-pointer">Unavailable for this model</summary>
                <ul className="mt-1 space-y-1">
                  {capabilities.unavailable.map((c) => (
                    <li key={c.id}>
                      <span className="font-medium">{c.label}</span> —{" "}
                      {AVAILABILITY_LABELS[c.availability]}. {c.reason}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        </details>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void preview()}
            disabled={busy}
            className="flex-1 rounded-md border border-ink-300 bg-white px-3 py-2 text-sm font-medium text-ink-800 hover:bg-ink-50 disabled:opacity-50"
          >
            {busy ? "Working…" : "Preview prompt"}
          </button>
          <button
            type="button"
            onClick={() => void generate()}
            disabled={!canGenerate}
            className="flex-1 rounded-md bg-ink-800 px-3 py-2 text-sm font-medium text-ink-50 shadow-xs hover:bg-ink-900 disabled:opacity-50"
          >
            {busy ? "Generating…" : "Generate"}
          </button>
        </div>

        <p className="text-ink-400 text-[11px]">
          Uses the assembled story bible (token-budgeted) plus your scene. The saved scene content
          and any edits you have typed are both considered.
        </p>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {error && (
          <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </p>
        )}

        {accepted && !outcome && (
          <p
            data-testid="ai-accepted"
            role="status"
            className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800"
          >
            Added to the scene. Generate again for another passage.
          </p>
        )}

        {outcome?.kind === "generated" && (
          <div data-testid="ai-result" className="space-y-2">
            <p className="text-ink-400 text-[11px]">
              Generated with {outcome.result.model}
              {edited ? " · edited" : ""}
            </p>
            {outcome.result.applied && (
              <p data-testid="ai-applied" className="text-ink-400 text-[11px]">
                Applied: {describeApplied(outcome.result.applied)}
              </p>
            )}
            <label className="block">
              <span className="sr-only">Generated prose (editable)</span>
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={10}
                className="border-ink-300 w-full rounded-md border bg-ink-50 px-2 py-1.5 font-serif text-sm text-ink-900"
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={accept}
                disabled={busy || !draft.trim()}
                className="rounded bg-ink-800 px-2 py-1 text-xs font-medium text-ink-50 hover:bg-ink-900 disabled:opacity-50"
              >
                Accept &amp; append
              </button>
              <button
                type="button"
                onClick={() => void generate()}
                disabled={!canGenerate}
                className="rounded border border-ink-300 px-2 py-1 text-xs font-medium text-ink-700 hover:bg-ink-50 disabled:opacity-50"
              >
                {busy ? "Regenerating…" : "Regenerate"}
              </button>
              {edited && (
                <button
                  type="button"
                  onClick={() => setDraft(outcome.result.text)}
                  className="rounded border border-ink-300 px-2 py-1 text-xs font-medium text-ink-700 hover:bg-ink-50"
                >
                  Revert edits
                </button>
              )}
              <button
                type="button"
                onClick={() => void copy(draft, "result")}
                className="rounded border border-ink-300 px-2 py-1 text-xs font-medium text-ink-700 hover:bg-ink-50"
              >
                {copied === "result" ? "Copied" : "Copy"}
              </button>
              <button
                type="button"
                onClick={discard}
                disabled={busy}
                className="rounded px-2 py-1 text-xs font-medium text-ink-500 hover:bg-ink-100 disabled:opacity-50"
              >
                Discard
              </button>
            </div>
          </div>
        )}

        {outcome?.kind === "preview" && (
          <div data-testid="ai-prompt-preview" className="space-y-2">
            <p className="text-ink-400 text-[11px]">
              Preview of “{outcome.result.prompt.name}” ({outcome.result.prompt.scope}) — exact
              messages Generate will send.
            </p>
            {(outcome.result.unresolved.length > 0 || outcome.result.unknownTokens.length > 0) && (
              <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Unresolved:{" "}
                {[...outcome.result.unresolved, ...outcome.result.unknownTokens].join(", ") ||
                  "none"}
              </p>
            )}
            {outcome.result.messages.map((m, i) => (
              <div key={`${m.role}-${i}`}>
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-ink-500 text-[11px] font-semibold uppercase">
                    {m.role} message
                  </span>
                  <button
                    type="button"
                    onClick={() => void copy(m.content, `preview-${m.role}-${i}`)}
                    className="rounded border border-ink-300 px-2 py-0.5 text-[11px] font-medium text-ink-700 hover:bg-ink-50"
                  >
                    {copied === `preview-${m.role}-${i}` ? "Copied" : "Copy"}
                  </button>
                </div>
                <pre className="border-ink-200 max-h-60 overflow-y-auto rounded border bg-ink-50 p-2 text-[11px] whitespace-pre-wrap text-ink-700">
                  {m.content}
                </pre>
              </div>
            ))}
            <details className="text-[11px] text-ink-500">
              <summary className="cursor-pointer">Joined debug string</summary>
              <pre className="border-ink-200 mt-1 max-h-40 overflow-y-auto rounded border bg-ink-50 p-2 whitespace-pre-wrap">
                {outcome.result.joined}
              </pre>
            </details>
          </div>
        )}

        {outcome?.kind === "not-configured" && (
          <div data-testid="ai-not-configured" className="space-y-2">
            <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {outcome.message} — the fully assembled prompt is below; copy it into any LLM chat to
              keep writing.
            </p>
            {(["system", "user"] as const).map((role) => (
              <div key={role}>
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-ink-500 text-[11px] font-semibold uppercase">
                    {role} message
                  </span>
                  <button
                    type="button"
                    onClick={() => void copy(promptPreview?.[role] ?? "", role)}
                    className="rounded border border-ink-300 px-2 py-0.5 text-[11px] font-medium text-ink-700 hover:bg-ink-50"
                  >
                    {copied === role ? "Copied" : "Copy"}
                  </button>
                </div>
                <pre className="border-ink-200 max-h-60 overflow-y-auto rounded border bg-ink-50 p-2 text-[11px] whitespace-pre-wrap text-ink-700">
                  {promptPreview?.[role] ?? ""}
                </pre>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
