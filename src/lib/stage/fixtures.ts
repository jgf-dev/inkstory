/**
 * Stage Mode fixture data (JGF-128, design rev 4 §1.1 item 1 — Stage Mode).
 *
 * The multi-agent enactment backend is not wired yet; until it lands, the
 * Stage console runs on typed fixtures so the interaction loop (run rehearsal
 * → review beat → insert into scene) is real and testable. The UI labels the
 * panel as a fixture preview so authors are never misled about data origin.
 */

export interface StageAgentFixture {
  id: string;
  name: string;
  /** Character/role the agent enacts. */
  role: string;
}

export interface RehearsalBeat {
  id: string;
  agentId: string;
  /** Enacted dialogue/action text, insertable into the scene. */
  text: string;
}

export const STAGE_FIXTURE_AGENTS: readonly StageAgentFixture[] = [
  { id: "agent-protagonist", name: "Mara", role: "Protagonist" },
  { id: "agent-antagonist", name: "Harbormaster Qhu", role: "Antagonist" },
] as const;

export const STAGE_FIXTURE_BEATS: readonly RehearsalBeat[] = [
  {
    id: "beat-1",
    agentId: "agent-protagonist",
    text: "Mara kept her voice low. “The shipment was sealed when it left my hands. Check the manifest again.”",
  },
  {
    id: "beat-2",
    agentId: "agent-antagonist",
    text: "Qhu slid the ledger across the desk. “The seal was broken before dawn. Someone on this quay is lying to me.”",
  },
  {
    id: "beat-3",
    agentId: "agent-protagonist",
    text: "“Then we find them before the tide turns,” Mara said, already reaching for her coat.",
  },
  {
    id: "beat-4",
    agentId: "agent-antagonist",
    text: "“Careful, Vance.” Qhu’s smile did not reach his eyes. “The tide turns for everyone.”",
  },
] as const;

/**
 * Picks the next fixture beat after `lastBeatId` (cyclical, in fixture
 * order). Starts from the first beat when `lastBeatId` is null/unknown.
 */
export function nextFixtureBeat(lastBeatId: string | null): RehearsalBeat {
  const index = STAGE_FIXTURE_BEATS.findIndex((b) => b.id === lastBeatId);
  return STAGE_FIXTURE_BEATS[(index + 1) % STAGE_FIXTURE_BEATS.length];
}
