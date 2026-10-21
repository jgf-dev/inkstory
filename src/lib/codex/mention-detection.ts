export interface CandidateEntity {
  id: string;
  name: string;
  aliases?: Array<{ name: string } | string>;
}

export interface MentionMatch {
  entryId: string;
  matchedText: string; // The canonical name/alias from the entry
  originalText: string; // The exact substring found in the source text
  matchType: "name" | "alias";
  startIndex: number;
  endIndex: number; // exclusive
}

export interface MentionDetectionResult {
  matchedEntryIds: string[];
  matches: MentionMatch[];
}

interface TargetPhrase {
  entryId: string;
  phrase: string;
  matchType: "name" | "alias";
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function intervalsOverlap(start1: number, end1: number, start2: number, end2: number): boolean {
  return Math.max(start1, start2) < Math.min(end1, end2);
}

interface RawMatch extends MentionMatch {
  length: number;
}

function aliasText(alias: { name: string } | string): string | undefined {
  return typeof alias === "string" ? alias.trim() : alias.name?.trim();
}

/** Collect every non-empty name and alias phrase for the candidate entries. */
function collectPhrases(entries: CandidateEntity[]): TargetPhrase[] {
  const phrases: TargetPhrase[] = [];
  for (const entry of entries) {
    const trimmedName = entry.name?.trim();
    if (trimmedName) {
      phrases.push({ entryId: entry.id, phrase: trimmedName, matchType: "name" });
    }
    for (const alias of entry.aliases ?? []) {
      const aliasName = aliasText(alias);
      if (aliasName) {
        phrases.push({ entryId: entry.id, phrase: aliasName, matchType: "alias" });
      }
    }
  }
  return phrases;
}

/** Find every word-boundary-aware, case-insensitive occurrence of a phrase in the text. */
function findPhraseMatches(text: string, item: TargetPhrase): RawMatch[] {
  const escaped = escapeRegex(item.phrase);
  // Use Unicode-aware lookbehind & lookahead for word boundaries so punctuation / quotes work
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}_])(${escaped})(?![\\p{L}\\p{N}_])`, "giu");
  const matches: RawMatch[] = [];
  for (const match of text.matchAll(pattern)) {
    const matchText = match[1];
    const start = match.index;
    matches.push({
      entryId: item.entryId,
      matchedText: item.phrase,
      originalText: matchText,
      matchType: item.matchType,
      startIndex: start,
      endIndex: start + matchText.length,
      length: matchText.length,
    });
  }
  return matches;
}

/** Longer matches first, then earlier matches first. */
function compareByPrecedence(a: RawMatch, b: RawMatch): number {
  return b.length - a.length || a.startIndex - b.startIndex;
}

/** Greedy non-overlapping interval selection in precedence order. */
function selectNonOverlapping(rawMatches: RawMatch[]): MentionMatch[] {
  const accepted: MentionMatch[] = [];
  for (const candidate of [...rawMatches].sort(compareByPrecedence)) {
    const hasOverlap = accepted.some((m) =>
      intervalsOverlap(candidate.startIndex, candidate.endIndex, m.startIndex, m.endIndex),
    );
    if (!hasOverlap) {
      accepted.push({
        entryId: candidate.entryId,
        matchedText: candidate.matchedText,
        originalText: candidate.originalText,
        matchType: candidate.matchType,
        startIndex: candidate.startIndex,
        endIndex: candidate.endIndex,
      });
    }
  }
  return accepted;
}

/**
 * Pure function that scans text for Codex entry names and aliases.
 *
 * Requirements satisfied:
 * - Case-insensitive matching
 * - Word-boundary aware (handles punctuation, quotes, apostrophes without matching substrings of longer words)
 * - Longer-match precedence for overlapping mentions (e.g. "The Glass Weaver" beats "Glass Weaver")
 * - Returns precise character spans [startIndex, endIndex)
 */
export function detectMentionsInText(
  text: string,
  entries: CandidateEntity[],
): MentionDetectionResult {
  if (!text || !entries || entries.length === 0) {
    return { matchedEntryIds: [], matches: [] };
  }

  // Longest phrases first so equal-length ties keep the original scan order.
  const phrases = collectPhrases(entries).sort((a, b) => b.phrase.length - a.phrase.length);
  const rawMatches = phrases.flatMap((item) => findPhraseMatches(text, item));

  // Accepted matches in text order, and unique entry IDs in occurrence order.
  const matches = selectNonOverlapping(rawMatches).sort((a, b) => a.startIndex - b.startIndex);
  const matchedEntryIds = [...new Set(matches.map((m) => m.entryId))];

  return { matchedEntryIds, matches };
}
