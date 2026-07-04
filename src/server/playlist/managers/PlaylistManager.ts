import {
  createSentenceEngine,
  type SentenceEngine,
} from "../engines/SentenceEngine";
import {
  createSpotifyEngine,
  type SpotifyEngine,
} from "../engines/SpotifyEngine";
import {
  createSpotifyResource,
  type SpotifyResource,
  type TrackCandidate,
} from "../resources/SpotifyResource";

// PlaylistManager — orchestrates the Playlist use cases. It owns the
// backtracking loop (brief §3, a locked decision): try a candidate grouping →
// validate against search results → on failure try the next candidate,
// re-deriving groupings for the remainder. Candidate generation
// (SentenceEngine) and match judgement (SpotifyEngine) hold the business
// logic; search HTTP lives in SpotifyResource.
//
// The access token is a parameter for now: Iteration 3 adds the
// UserManagerResource adapter (ADR 0009) and the generate endpoint, at which
// point the manager obtains the token itself.

export interface MatchedTrack {
  /** The sentence phrase (normalized words) this track spells. */
  phrase: string;
  track: TrackCandidate;
}

export type SentenceMatchResult =
  | { ok: true; tracks: MatchedTrack[] }
  | {
      /** ADR 0003: no full cover ⇒ no playlist; report what to reword. */
      ok: false;
      unmatched: string[];
    };

export interface PlaylistManager {
  matchSentence(
    accessToken: string,
    sentence: string,
  ): Promise<SentenceMatchResult>;
}

export interface PlaylistManagerDeps {
  sentenceEngine: SentenceEngine;
  spotifyEngine: SpotifyEngine;
  spotifyResource: SpotifyResource;
}

export function makePlaylistManager(
  deps: PlaylistManagerDeps,
): PlaylistManager {
  const { sentenceEngine, spotifyEngine, spotifyResource } = deps;

  return {
    async matchSentence(accessToken, sentence) {
      const words = sentenceEngine.tokenize(sentence);
      if (words.length === 0) return { ok: false, unmatched: [] };

      // Backtracking re-derives groupings for the remainder, so the same
      // variant can come up on several paths — search each one only once.
      const matchByVariant = new Map<string, TrackCandidate | null>();

      // Failure report: the candidate phrases that all failed at the deepest
      // word position any path reached — the part of the sentence the user
      // has to reword (ADR 0003).
      let deepestFailIndex = -1;
      let deepestFailPhrases: string[] = [];

      function recordFailure(index: number, phrase: string) {
        if (index > deepestFailIndex) {
          deepestFailIndex = index;
          deepestFailPhrases = [];
        }
        if (
          index === deepestFailIndex &&
          !deepestFailPhrases.includes(phrase)
        ) {
          deepestFailPhrases.push(phrase);
        }
      }

      async function findTrack(
        variant: string,
      ): Promise<TrackCandidate | null> {
        const cached = matchByVariant.get(variant);
        if (cached !== undefined) return cached;
        const results = await spotifyResource.searchTracks(
          accessToken,
          variant,
        );
        const match = spotifyEngine.findMatch(variant, results) ?? null;
        matchByVariant.set(variant, match);
        return match;
      }

      // Depth-first over word positions: cover the words from `index` on, or
      // return null so the caller backtracks to its next candidate.
      async function cover(index: number): Promise<MatchedTrack[] | null> {
        if (index === words.length) return [];

        for (const candidate of sentenceEngine.candidatesAt(words, index)) {
          let match: TrackCandidate | null = null;
          for (const variant of candidate.variants) {
            match = await findTrack(variant);
            if (match) break;
          }
          if (!match) {
            recordFailure(index, candidate.phrase);
            continue;
          }
          const rest = await cover(index + candidate.wordCount);
          if (rest)
            return [{ phrase: candidate.phrase, track: match }, ...rest];
        }
        return null;
      }

      const tracks = await cover(0);
      return tracks
        ? { ok: true, tracks }
        : { ok: false, unmatched: deepestFailPhrases };
    },
  };
}

/** Wire a PlaylistManager with the real engines and Spotify search. */
export function createPlaylistManager(): PlaylistManager {
  return makePlaylistManager({
    sentenceEngine: createSentenceEngine(),
    spotifyEngine: createSpotifyEngine(),
    spotifyResource: createSpotifyResource(),
  });
}
