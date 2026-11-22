"use client";

import { useState } from "react";
import { nextFixtureBeat, STAGE_FIXTURE_AGENTS, type RehearsalBeat } from "@/lib/stage/fixtures";

function resolveAgentName(agentId: string): string {
  return STAGE_FIXTURE_AGENTS.find((a) => a.id === agentId)?.name ?? "Agent";
}

export interface StageConsolePanelProps {
  /** Inserts a rehearsed beat into the active scene prose. */
  onInsertBeat: (text: string) => void;
}

interface TranscriptEntry extends RehearsalBeat {
  seq: number;
}

/**
 * Stage Mode enactment console (JGF-128, design rev 4 §1.1 item 1 — right
 * half of the 50/50 split). Runs dialogue rehearsal beats and inserts them
 * into the scene. Until the multi-agent backend lands, beats come from typed
 * fixtures and the panel says so.
 */
export function StageConsolePanel({ onInsertBeat }: Readonly<StageConsolePanelProps>) {
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);

  function runNextBeat() {
    const next = nextFixtureBeat(transcript.at(-1)?.id ?? null);
    setTranscript((prev) => [...prev, { ...next, seq: (prev.at(-1)?.seq ?? 0) + 1 }]);
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="stage-console">
      <header className="border-b border-ink-200 px-4 py-3">
        <h2 className="text-sm font-semibold text-primary">Enactment Console</h2>
        <p className="mt-0.5 text-[11px] text-muted">
          Fixture preview — the multi-agent rehearsal backend is not wired yet.
        </p>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {transcript.length === 0 ? (
          <div className="mt-6 rounded-lg border border-dashed border-ink-200 p-6 text-center">
            <p className="text-sm font-medium text-secondary">No rehearsal yet</p>
            <p className="mt-1 text-xs text-muted">
              Run a beat to hear how the scene plays between characters.
            </p>
          </div>
        ) : (
          <ol className="space-y-3" data-testid="stage-transcript">
            {transcript.map((entry) => (
              <li
                key={`${entry.id}-${entry.seq}`}
                className="rounded-lg border border-ink-200 bg-card p-3"
              >
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                  {resolveAgentName(entry.agentId)}
                </p>
                <p className="prose-canvas mt-1 text-sm leading-6 text-primary">{entry.text}</p>
                <button
                  type="button"
                  onClick={() => onInsertBeat(entry.text)}
                  className="mt-2 min-h-11 rounded-md border border-ink-200 px-3 text-xs font-medium text-secondary hover:bg-ink-100"
                >
                  Insert beat into scene
                </button>
              </li>
            ))}
          </ol>
        )}
      </div>

      <footer className="border-t border-ink-200 px-4 py-3">
        <button
          type="button"
          onClick={runNextBeat}
          className="min-h-11 w-full rounded-md bg-ink-800 px-4 text-sm font-medium text-ink-50 hover:bg-ink-900"
        >
          {transcript.length === 0 ? "Run rehearsal" : "Run next beat"}
        </button>
      </footer>
    </div>
  );
}
