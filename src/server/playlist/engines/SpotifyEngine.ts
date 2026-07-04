import { normalize, normalizeTitle } from "@/server/shared/normalize";

// SpotifyEngine — match-quality judgement (ADR 0003): a track counts as a
// match for a phrase variant only when title and phrase are equal after
// normalization. Version-suffix stripping applies to the title side only —
// a phrase comes from the user's sentence, where "(...)" is real words.
// Pure logic — it judges search results, it does not fetch them
// (SpotifyResource) or decide what to try next (PlaylistManager).

export interface SpotifyEngine {
  /** First track whose title matches the phrase variant, if any. */
  findMatch<T extends { name: string }>(
    phraseVariant: string,
    tracks: T[],
  ): T | undefined;
}

export function createSpotifyEngine(): SpotifyEngine {
  return {
    findMatch(phraseVariant, tracks) {
      const target = normalize(phraseVariant);
      // A phrase that normalizes away entirely must not match titles that do
      // the same (e.g. "(Live)").
      if (!target) return undefined;
      return tracks.find((track) => normalizeTitle(track.name) === target);
    },
  };
}
