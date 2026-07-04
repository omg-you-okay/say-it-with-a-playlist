// Shared normalization for phrase ↔ track-title comparison (ADR 0003). Both
// sides of the match — the candidate phrase (SentenceEngine) and the track
// title (SpotifyEngine) — pass through this before the exact-equality check.
// A stateless helper, deliberately not an Engine (ADR 0010).

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

export function normalize(text: string): string {
  let s = text;
  while (VERSION_GROUP_TAIL.test(s)) s = s.replace(VERSION_GROUP_TAIL, "");
  s = s.replace(DASH_TAIL, "");
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .replace(/['’]/g, "") // "don't" → "dont", not "don t"
    .replace(NON_MATCH_CHARS, " ")
    .trim();
}
