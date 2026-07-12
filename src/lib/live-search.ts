// The shapes the live search view renders. These are view models derived from
// the NDJSON events (src/lib/preview-stream.ts) — they are not the wire
// contract, and they stay in the ui layer with it (ADR 0008 pattern).

import type { TrackCandidate } from "./preview-stream";

/** A track the loop has placed at a word position — for now. */
export interface ResolvedTrack {
  /** Word position it starts at. Also the key the prune rule works on. */
  index: number;
  /** How many words it covers — the strip needs this to know what is left. */
  wordCount: number;
  phrase: string;
  track: TrackCandidate;
}

/** The candidate grouping the loop is trying right now. */
export interface CurrentTry {
  index: number;
  phrase: string;
  words: number;
}

export type LogKind = "tokenise" | "try" | "hit" | "miss" | "split" | "done";

export interface LogLine {
  id: number;
  kind: LogKind;
  message: string;
  /** The dimmer second line: the artist, the word count, the search cost. */
  detail?: string;
}

/**
 * The sentence carved by the grouping the loop is currently committed to:
 * the phrases it has placed, the one it is trying, and the words it has not
 * reached. Rendering this from `index` (rather than from a running total)
 * keeps it honest across backtracking — an `index` *is* the loop's position,
 * so a `try` that re-treads a position implicitly discards everything after it.
 */
export interface CarvedSentence {
  placed: ResolvedTrack[];
  trying: CurrentTry | null;
  /** Words after the current attempt — not yet reached. */
  rest: string[];
}

export function carveSentence(
  tokens: string[],
  placed: ResolvedTrack[],
  trying: CurrentTry | null,
): CarvedSentence {
  const consumed = trying
    ? trying.index + trying.words
    : placed.reduce((total, item) => total + item.wordCount, 0);
  return { placed, trying, rest: tokens.slice(consumed) };
}
