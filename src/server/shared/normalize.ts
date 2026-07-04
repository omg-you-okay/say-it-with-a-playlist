// Shared normalization for phrase ↔ track-title comparison (ADR 0003). Both
// sides of the match pass through here before the exact-equality check:
// the candidate phrase (SentenceEngine) through `normalize`, the track title
// (SpotifyEngine) through `normalizeTitle` — version-suffix stripping is a
// title-only concern; applied to a user sentence it would eat real words
// ("call me (maybe)" must keep "maybe"). Stateless helpers, deliberately not
// an Engine (ADR 0010).

// A trailing "(Remastered 2011)" / "[Live]" version group.
const VERSION_GROUP_TAIL = /\s*(\([^)]*\)|\[[^\]]*\])\s*$/;
// A " - Radio Edit" style dash tail (dash must be space-delimited so hyphenated
// words like "T-Shirt" survive).
const DASH_TAIL = /\s+-\s.*$/;
// Combining marks left over after NFD decomposition (e.g. é → e + U+0301).
const COMBINING_MARKS = /[\u0300-\u036f]/g;
// Everything that is not a letter, digit, or "&" becomes a space. "&" and
// digits survive because they are substitution targets (and→&, to→2, …).
const NON_MATCH_CHARS = /[^\p{L}\p{N}&]+/gu;

/** Lowercase, strip diacritics and punctuation, collapse whitespace. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .replace(/['’]/g, "") // "don't" → "dont", not "don t"
    .replace(NON_MATCH_CHARS, " ")
    .trim();
}

/**
 * `normalize`, plus version-suffix stripping for track titles. Tails are
 * stripped to a fixed point because they stack and hide one another:
 * "Song (Live) - Remix" only exposes "(Live)" after the dash tail goes.
 */
export function normalizeTitle(title: string): string {
  let s = title;
  let before: string;
  do {
    before = s;
    s = s.replace(VERSION_GROUP_TAIL, "").replace(DASH_TAIL, "");
  } while (s !== before);
  return normalize(s);
}
