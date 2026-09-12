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

  // 1. Collect and deduplicate phrases per entry
  const phrases: TargetPhrase[] = [];

  for (const entry of entries) {
    const trimmedName = entry.name?.trim();
    if (trimmedName) {
      phrases.push({
        entryId: entry.id,
        phrase: trimmedName,
        matchType: "name",
      });
    }

    if (entry.aliases && entry.aliases.length > 0) {
      for (const a of entry.aliases) {
        const aliasName = typeof a === "string" ? a.trim() : a.name?.trim();
        if (aliasName) {
          phrases.push({
            entryId: entry.id,
            phrase: aliasName,
            matchType: "alias",
          });
        }
      }
    }
  }

  // 2. Sort phrases by length descending (longest first for overlap resolution)
  phrases.sort((a, b) => b.phrase.length - a.phrase.length);

  interface RawMatch {
    entryId: string;
    matchedText: string;
    originalText: string;
    matchType: "name" | "alias";
    startIndex: number;
    endIndex: number;
    length: number;
  }

  const rawMatches: RawMatch[] = [];

  for (const item of phrases) {
    const escaped = escapeRegex(item.phrase);
    // Use Unicode-aware lookbehind & lookahead for word boundaries so punctuation / quotes work
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}_])(${escaped})(?![\\p{L}\\p{N}_])`, "giu");

    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const matchText = match[1];
      const start = match.index;
      const end = start + matchText.length;

      rawMatches.push({
        entryId: item.entryId,
        matchedText: item.phrase,
        originalText: matchText,
        matchType: item.matchType,
        startIndex: start,
        endIndex: end,
        length: matchText.length,
      });
    }
  }

  // 3. Sort raw matches:
  // Primary sort: Length descending (longer wins)
  // Secondary sort: startIndex ascending
  rawMatches.sort((a, b) => {
    if (b.length !== a.length) {
      return b.length - a.length;
    }
    return a.startIndex - b.startIndex;
  });

  // 4. Greedy non-overlapping interval selection
  const acceptedMatches: MentionMatch[] = [];
  const occupiedIntervals: Array<{ start: number; end: number }> = [];

  for (const candidate of rawMatches) {
    const hasOverlap = occupiedIntervals.some((interval) =>
      intervalsOverlap(candidate.startIndex, candidate.endIndex, interval.start, interval.end),
    );

    if (!hasOverlap) {
      occupiedIntervals.push({
        start: candidate.startIndex,
        end: candidate.endIndex,
      });

      acceptedMatches.push({
        entryId: candidate.entryId,
        matchedText: candidate.matchedText,
        originalText: candidate.originalText,
        matchType: candidate.matchType,
        startIndex: candidate.startIndex,
        endIndex: candidate.endIndex,
      });
    }
  }

  // 5. Sort final accepted matches chronologically by text order
  acceptedMatches.sort((a, b) => a.startIndex - b.startIndex);

  // 6. Collect unique matched entry IDs preserving occurrence order
  const uniqueEntryIds: string[] = [];
  const seen = new Set<string>();
  for (const m of acceptedMatches) {
    if (!seen.has(m.entryId)) {
      seen.add(m.entryId);
      uniqueEntryIds.push(m.entryId);
    }
  }

  return {
    matchedEntryIds: uniqueEntryIds,
    matches: acceptedMatches,
  };
}
