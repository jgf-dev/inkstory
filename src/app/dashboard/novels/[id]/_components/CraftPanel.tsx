"use client";

import { useEffect, useMemo, useState } from "react";
import type { CredentialDto } from "@/lib/ai/credentials/service";
import {
  SUGGESTED_ACTION_LABELS,
  buildCraftInputs,
  formInputs,
  initialFormValues,
  integerBounds,
  optionLabel,
  textMaxLength,
  usesSelection,
  validateCraftForm,
  type CraftFormValues,
  type CraftToolDto,
} from "@/lib/craft/client";
import type { ContractInput } from "@/lib/prompts/contracts";
import { countWords, formatWordCount } from "@/lib/writing/word-count";
import type { EditorSelection } from "./RichTextEditor";
import { apiGet } from "./api";
import { useCraftRun, type CraftRunRequest, type CraftRunResult } from "./useCraftRun";
import { useCraftTools } from "./useCraftTools";

export type CraftApplyResult = { ok: true } | { ok: false; message: string };

export interface CraftPanelProps {
  sceneId: string;
  /** Current (possibly unsaved) scene prose. */
  content: string;
  /** Live editor selection (null when only a caret). */
  selection: EditorSelection | null;
  /** Scene opted out of AI: the panel explains and disables runs. */
  excludeFromAi: boolean;
  /**
   * Checkpoints the scene then replaces `range` with `text` (SceneEditor owns
   * the save/checkpoint ordering).
   */
  onApply: (range: EditorSelection, text: string) => Promise<CraftApplyResult>;
  onClose: () => void;
}

const PREVIEW_CHARS = 280;

/**
 * Craft Studio editor panel (STO-1290; scaffold STO-1266, Describe STO-1267).
 * The tool list and each form come from the server contracts; results are
 * transient until the author explicitly applies them, and Apply always takes
 * a MANUAL checkpoint first so it can be undone from version history.
 */
export function CraftPanel(props: CraftPanelProps) {
  const { tools, loading, error: toolsError, reload } = useCraftTools();
  const { state, run, reset } = useCraftRun();
  const [toolId, setToolId] = useState<string | null>(null);
  /** Form values are keyed by tool so switching tools starts from that tool's defaults. */
  const [form, setForm] = useState<{ toolId: string; values: CraftFormValues } | null>(null);
  const [lastDone, setLastDone] = useState<{
    request: CraftRunRequest;
    result: CraftRunResult;
  } | null>(null);
  const [prevState, setPrevState] = useState(state);
  const [draftEdit, setDraftEdit] = useState<{ result: CraftRunResult; text: string } | null>(null);
  const [applying, setApplying] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [credentials, setCredentials] = useState<CredentialDto[]>([]);
  const [credentialId, setCredentialId] = useState("");
  const [model, setModel] = useState("");

  if (prevState !== state) {
    setPrevState(state);
    if (state.kind === "done") {
      setLastDone({ request: state.request, result: state.result });
      setDraftEdit(null);
    } else if (state.kind === "not-configured" || state.kind === "idle") {
      setLastDone(null);
      setDraftEdit(null);
    }
  }

  const tool: CraftToolDto | null = useMemo(
    () => tools.find((t) => t.id === toolId) ?? tools[0] ?? null,
    [tools, toolId],
  );

  const values: CraftFormValues = useMemo(() => {
    if (!tool) return {};
    return form?.toolId === tool.id ? form.values : initialFormValues(tool);
  }, [tool, form]);

  useEffect(() => {
    let active = true;
    apiGet<{ credentials?: CredentialDto[] }>("/api/ai/credentials")
      .then((res) => {
        if (active) setCredentials(Array.isArray(res?.credentials) ? res.credentials : []);
      })
      .catch(() => {
        // Platform gateway stays available; BYOK is optional here.
      });
    return () => {
      active = false;
    };
  }, []);

  const selectionText = props.selection?.text ?? "";
  const needsSelection = tool ? usesSelection(tool) : false;
  const problems = tool ? validateCraftForm(tool, values, selectionText) : [];
  const running = state.kind === "running";
  const byokIncomplete = Boolean(credentialId) && !model.trim();
  const canRun =
    Boolean(tool) && !props.excludeFromAi && !running && !applying && problems.length === 0;

  const activeDone =
    state.kind === "done"
      ? { request: state.request, result: state.result }
      : state.kind === "running" || state.kind === "error"
        ? lastDone
        : null;
  const result = activeDone?.result ?? null;
  const draft = result ? (draftEdit?.result === result ? draftEdit.text : result.text) : "";
  const edited = result !== null && draft !== result.text;
  const targetWords = Number(activeDone?.request.inputs["craft.target_words"]);
  const suggested = result?.output?.suggestedAction ?? null;
  const canReplace = suggested === "replace_selection" && Boolean(result?.selection);

  function setValue(key: ContractInput["key"], value: string | boolean) {
    if (!tool) return;
    setForm({ toolId: tool.id, values: { ...values, [key]: value } });
  }

  function selectTool(id: string) {
    if (id === tool?.id) return;
    setToolId(id);
    reset();
    setLastDone(null);
    setDraftEdit(null);
    setNotice(null);
  }

  function startRun(request = state.kind !== "idle" ? state.request : null) {
    if (props.excludeFromAi || running || applying) return;
    setNotice(null);
    setCopied(false);
    if (request) {
      void run(request);
      return;
    }
    if (!tool || !canRun || byokIncomplete) return;
    setLastDone(null);
    setDraftEdit(null);
    void run({
      toolId: tool.id,
      sceneId: props.sceneId,
      inputs: buildCraftInputs(tool, values, selectionText),
      content: props.content,
      selection: needsSelection ? props.selection : null,
      ...(credentialId ? { credentialId, model: model.trim() } : {}),
    });
  }

  async function apply() {
    if (!result?.selection || running || !draft.trim()) return;
    setApplying(true);
    setNotice(null);
    try {
      const outcome = await props.onApply(result.selection, draft);
      if (outcome.ok) {
        reset();
        setLastDone(null);
        setDraftEdit(null);
        setNotice({
          tone: "ok",
          text: "Applied. A checkpoint of the previous text is in version history.",
        });
      } else {
        setNotice({ tone: "error", text: outcome.message });
      }
    } finally {
      setApplying(false);
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setNotice({ tone: "error", text: "Copy failed — select the text manually." });
    }
  }

  function discard() {
    reset();
    setLastDone(null);
    setDraftEdit(null);
    setNotice(null);
  }

  return (
    <div className="flex h-full flex-col" data-testid="craft-panel">
      <header className="border-ink-200 flex items-center justify-between border-b px-4 py-3">
        <h2 className="text-sm font-semibold text-ink-900">Craft</h2>
        <button
          type="button"
          onClick={props.onClose}
          aria-label="Close craft panel"
          className="rounded px-2 py-1 text-xs text-ink-500 hover:bg-ink-100"
        >
          ✕
        </button>
      </header>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {loading && <p className="text-muted text-xs">Loading tools…</p>}
        {toolsError && (
          <div className="space-y-1" role="alert">
            <p className="text-xs text-red-600">{toolsError}</p>
            <button
              type="button"
              onClick={reload}
              className="text-ink-600 text-xs underline hover:text-ink-900"
            >
              Retry
            </button>
          </div>
        )}
        {!loading && !toolsError && tools.length === 0 && (
          <p className="text-muted text-xs">No craft tools are available.</p>
        )}

        {tool && (
          <>
            {tools.length > 1 && (
              <div className="flex flex-wrap gap-1" role="tablist" aria-label="Craft tool">
                {tools.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    role="tab"
                    aria-selected={t.id === tool.id}
                    disabled={running || applying}
                    onClick={() => selectTool(t.id)}
                    className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                      t.id === tool.id
                        ? "bg-ink-800 text-ink-50"
                        : "bg-ink-100 text-ink-600 hover:bg-ink-200"
                    }`}
                  >
                    {t.name}
                  </button>
                ))}
              </div>
            )}
            <div>
              <p className="text-sm font-medium text-ink-900" data-testid="craft-tool-name">
                {tool.name}
              </p>
              <p className="text-muted text-xs">{tool.summary}</p>
            </div>

            {props.excludeFromAi && (
              <p
                className="rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-800"
                role="status"
              >
                This scene is excluded from AI assistance. Turn that off in Details to use Craft.
              </p>
            )}

            {needsSelection && (
              <div data-testid="craft-selection">
                <p className="text-ink-500 text-xs font-medium">
                  Selected prose
                  {selectionText && (
                    <span className="font-normal">
                      {" "}
                      · {formatWordCount(countWords(selectionText))}
                    </span>
                  )}
                </p>
                {selectionText ? (
                  <blockquote className="border-ink-200 text-ink-700 mt-1 max-h-28 overflow-y-auto border-l-2 pl-2 text-xs whitespace-pre-wrap">
                    {selectionText.length > PREVIEW_CHARS
                      ? `${selectionText.slice(0, PREVIEW_CHARS)}…`
                      : selectionText}
                  </blockquote>
                ) : (
                  <p className="text-muted mt-1 text-xs">
                    Select a passage in the scene to {tool.name.toLowerCase()} it.
                  </p>
                )}
              </div>
            )}

            {formInputs(tool).map((input) => (
              <CraftInputField
                key={input.key}
                input={input}
                value={values[input.key]}
                disabled={running || applying}
                problem={problems.find((p) => p.key === input.key)?.message ?? null}
                onChange={(value) => setValue(input.key, value)}
              />
            ))}

            <details className="text-xs text-muted">
              <summary className="cursor-pointer font-medium">Provider</summary>
              <div className="mt-2 space-y-2">
                <label className="block">
                  Generation provider
                  <select
                    aria-label="Craft provider"
                    value={credentialId}
                    disabled={running || applying}
                    onChange={(e) => {
                      setCredentialId(e.target.value);
                      setModel("");
                    }}
                    className="mt-1 w-full rounded border border-subtle bg-card p-2 text-primary"
                  >
                    <option value="">Platform gateway (default)</option>
                    {credentials.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.provider} — {c.label || "Default"} {c.keyHint ?? ""}
                      </option>
                    ))}
                  </select>
                </label>
                {credentialId && (
                  <label className="block">
                    Provider model ID
                    <input
                      aria-label="Craft model ID"
                      value={model}
                      maxLength={256}
                      disabled={running || applying}
                      onChange={(e) => setModel(e.target.value)}
                      placeholder="Enter a model ID supported by this provider"
                      className="mt-1 w-full rounded border border-subtle bg-card p-2 text-primary"
                    />
                  </label>
                )}
              </div>
            </details>

            {byokIncomplete && (
              <p className="text-muted text-xs" role="status" data-testid="craft-byok-hint">
                Enter a provider model ID under Provider to run with this credential.
              </p>
            )}

            <button
              type="button"
              disabled={!canRun || byokIncomplete}
              onClick={() => startRun(null)}
              className="w-full rounded-md bg-ink-800 px-3 py-2 text-xs font-medium text-ink-50 hover:bg-ink-900 disabled:opacity-50"
            >
              {running ? "Working…" : tool.name}
            </button>
          </>
        )}

        {state.kind === "error" && (
          <p className="text-xs text-red-600" role="alert" data-testid="craft-error">
            {state.message}
          </p>
        )}

        {state.kind === "not-configured" && (
          <div className="space-y-2" data-testid="craft-not-configured">
            <p className="rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
              {state.message}
            </p>
            {state.prompt && (
              <>
                <pre className="border-ink-200 max-h-40 overflow-y-auto rounded border bg-ink-50 p-2 text-[11px] whitespace-pre-wrap">
                  {state.prompt}
                </pre>
                <button
                  type="button"
                  onClick={() => void copy(state.prompt)}
                  className="rounded border border-ink-200 px-2 py-1 text-[11px] font-medium text-ink-700 hover:bg-ink-50"
                >
                  {copied ? "Copied" : "Copy prompt"}
                </button>
              </>
            )}
          </div>
        )}

        {result && (
          <div className="space-y-2" data-testid="craft-result">
            <p className="text-ink-500 text-xs">
              {formatWordCount(countWords(draft))}
              {Number.isFinite(targetWords) && targetWords > 0 && ` (target ~${targetWords})`}
              {result.model && ` · ${result.model}`}
              {edited && " · edited"}
            </p>
            <textarea
              aria-label="Craft result (editable)"
              value={draft}
              disabled={running || applying}
              onChange={(e) => setDraftEdit({ result, text: e.target.value })}
              rows={10}
              className="border-subtle w-full rounded-md border bg-card px-2 py-1.5 text-sm text-primary"
            />
            <div className="flex flex-wrap gap-2">
              {canReplace && (
                <button
                  type="button"
                  disabled={running || applying || !draft.trim()}
                  onClick={() => void apply()}
                  className="rounded bg-ink-800 px-2.5 py-1 text-xs font-medium text-ink-50 hover:bg-ink-900 disabled:opacity-50"
                >
                  {applying ? "Applying…" : SUGGESTED_ACTION_LABELS.replace_selection}
                </button>
              )}
              <button
                type="button"
                disabled={!draft.trim()}
                onClick={() => void copy(draft)}
                className="rounded border border-ink-200 px-2.5 py-1 text-xs font-medium text-ink-700 hover:bg-ink-50"
              >
                {copied ? "Copied" : SUGGESTED_ACTION_LABELS.copy_only}
              </button>
              {edited && (
                <button
                  type="button"
                  disabled={running || applying}
                  onClick={() => setDraftEdit(null)}
                  className="rounded border border-ink-200 px-2.5 py-1 text-xs font-medium text-ink-700 hover:bg-ink-50 disabled:opacity-50"
                >
                  Revert edits
                </button>
              )}
              <button
                type="button"
                disabled={props.excludeFromAi || running || applying}
                onClick={() => startRun()}
                className="rounded border border-ink-200 px-2.5 py-1 text-xs font-medium text-ink-700 hover:bg-ink-50 disabled:opacity-50"
              >
                {running ? "Regenerating…" : "Regenerate"}
              </button>
              <button
                type="button"
                disabled={running || applying}
                onClick={discard}
                className="rounded border border-ink-200 px-2.5 py-1 text-xs font-medium text-ink-700 hover:bg-ink-50 disabled:opacity-50"
              >
                Discard
              </button>
            </div>
          </div>
        )}

        {notice && (
          <p
            role={notice.tone === "error" ? "alert" : "status"}
            data-testid="craft-notice"
            className={`text-xs ${notice.tone === "error" ? "text-red-600" : "text-emerald-700"}`}
          >
            {notice.text}
          </p>
        )}
      </div>
    </div>
  );
}

function CraftInputField(props: {
  input: ContractInput;
  value: string | boolean | undefined;
  disabled: boolean;
  problem: string | null;
  onChange: (value: string | boolean) => void;
}) {
  const { input } = props;
  const label = input.label ?? input.key;
  const field =
    "border-subtle mt-1 w-full rounded-md border bg-card px-2 py-1.5 text-sm text-primary";
  let control: React.ReactNode;
  if (input.type === "boolean") {
    return (
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={props.value === true}
          disabled={props.disabled}
          onChange={(e) => props.onChange(e.target.checked)}
          className="border-ink-300 h-4 w-4 rounded"
        />
        <span className="text-ink-700 text-xs">{label}</span>
      </label>
    );
  } else if (input.type === "enum") {
    control = (
      <select
        aria-label={label}
        value={typeof props.value === "string" ? props.value : ""}
        disabled={props.disabled}
        onChange={(e) => props.onChange(e.target.value)}
        className={field}
      >
        {input.options.map((option) => (
          <option key={option} value={option}>
            {optionLabel(option)}
          </option>
        ))}
      </select>
    );
  } else if (input.type === "integer") {
    const { min, max } = integerBounds(input);
    control = (
      <input
        type="number"
        aria-label={label}
        inputMode="numeric"
        min={min}
        max={max}
        step={1}
        value={typeof props.value === "string" ? props.value : ""}
        disabled={props.disabled}
        onChange={(e) => props.onChange(e.target.value)}
        className={field}
      />
    );
  } else {
    control = (
      <textarea
        aria-label={label}
        rows={2}
        maxLength={textMaxLength(input)}
        value={typeof props.value === "string" ? props.value : ""}
        disabled={props.disabled}
        placeholder={input.required ? "" : "Optional"}
        onChange={(e) => props.onChange(e.target.value)}
        className={field}
      />
    );
  }
  return (
    <div>
      <span className="text-ink-500 block text-xs font-medium">
        {label}
        {input.type === "integer" &&
          ` (${integerBounds(input).min.toLocaleString("en-US")}–${integerBounds(input).max.toLocaleString("en-US")})`}
      </span>
      {control}
      {input.description && <p className="text-muted mt-0.5 text-[11px]">{input.description}</p>}
      {props.problem && <p className="mt-0.5 text-[11px] text-red-600">{props.problem}</p>}
    </div>
  );
}
