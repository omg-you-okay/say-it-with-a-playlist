import { normalize } from "@/server/shared/normalize";

// SentenceEngine — candidate generation for sentence decomposition (brief §3).
//
// Pure logic, no external dependencies: it turns a sentence into words and
// produces, for any position, the candidate groupings to try — in priority
// order — with their search variants. It knows nothing about whether a
// candidate matches a real track; validation is SpotifyEngine's concern and
// the try/backtrack sequencing is PlaylistManager's.
//
// Priority order (the "defined priority order" the brief requires):
//   - groupings: longest span first (capped at `maxGroupingWords`), so the
//     search prefers phrase-like tracks over word-by-word playlists
//   - variants per grouping: fewest substitutions first — the original phrase,
//     then single substitutions in word order, … up to the fully-substituted
//     form (substitution map: ADR 0003)

// ADR 0003 substitution map, config-driven. Keys and values are in normalized
// (lowercase) form because variants are compared after `normalize`.
const DEFAULT_SUBSTITUTIONS: Record<string, string> = {
  to: "2",
  you: "u",
  for: "4",
  are: "r",
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
  ten: "10",
  and: "&",
  too: "2",
  be: "b",
  see: "c",
  why: "y",
  oh: "o",
  ex: "x",
};

// 5 words ≈ the longest plausible title phrase; also bounds the variant
// fan-out (≤ 2^5 searches per candidate before memoization).
const DEFAULT_MAX_GROUPING_WORDS = 5;

export interface Candidate {
  /** How many sentence words this grouping consumes. */
  wordCount: number;
  /** The grouping as written (normalized words, space-joined). */
  phrase: string;
  /** Query variants in priority order: original first, then substituted. */
  variants: string[];
}

export interface SentenceEngineConfig {
  substitutions?: Record<string, string>;
  maxGroupingWords?: number;
}

export interface SentenceEngine {
  tokenize(sentence: string): string[];
  candidatesAt(words: string[], startIndex: number): Candidate[];
}

function countBits(mask: number): number {
  let count = 0;
  for (let m = mask; m > 0; m >>= 1) count += m & 1;
  return count;
}

export function createSentenceEngine(
  config: SentenceEngineConfig = {},
): SentenceEngine {
  const substitutions = config.substitutions ?? DEFAULT_SUBSTITUTIONS;
  const maxGroupingWords =
    config.maxGroupingWords ?? DEFAULT_MAX_GROUPING_WORDS;

  // Every original/substituted combination for the grouping, ordered by number
  // of substitutions (then by earliest-word substitution), deduplicated.
  function variantsFor(words: string[]): string[] {
    const substitutable = words
      .map((word, i) => ({ word, i, sub: substitutions[word] }))
      .filter(({ word, sub }) => sub !== undefined && sub !== word);

    const masks = Array.from(
      { length: 1 << substitutable.length },
      (_, mask) => mask,
    ).sort((a, b) => countBits(a) - countBits(b) || a - b);

    const variants: string[] = [];
    const seen = new Set<string>();
    for (const mask of masks) {
      const result = [...words];
      substitutable.forEach(({ i, sub }, bit) => {
        if (mask & (1 << bit)) result[i] = sub!;
      });
      const variant = result.join(" ");
      if (!seen.has(variant)) {
        seen.add(variant);
        variants.push(variant);
      }
    }
    return variants;
  }

  return {
    tokenize(sentence) {
      return normalize(sentence).split(" ").filter(Boolean);
    },

    candidatesAt(words, startIndex) {
      const maxSpan = Math.min(maxGroupingWords, words.length - startIndex);
      const candidates: Candidate[] = [];
      for (let span = maxSpan; span >= 1; span--) {
        const grouping = words.slice(startIndex, startIndex + span);
        candidates.push({
          wordCount: span,
          phrase: grouping.join(" "),
          variants: variantsFor(grouping),
        });
      }
      return candidates;
    },
  };
}
