import {
  createSentenceEngine,
  type SentenceEngine,
} from "../engines/SentenceEngine";
import {
  createSpotifyEngine,
  type SpotifyEngine,
} from "../engines/SpotifyEngine";
import {
  createPlaylistResource,
  type PlaylistResource,
} from "../resources/PlaylistResource";
import {
  createSpotifyResource,
  type SpotifyResource,
  type TrackCandidate,
} from "../resources/SpotifyResource";
import {
  createUserManagerResource,
  type UserManagerResource,
} from "../resources/UserManagerResource";

// PlaylistManager — orchestrates the Playlist use cases. It owns the
// backtracking loop (brief §3, a locked decision): try a candidate grouping →
// validate against search results → on failure try the next candidate,
// re-deriving groupings for the remainder. Candidate generation
// (SentenceEngine) and match judgement (SpotifyEngine) hold the business
// logic; search HTTP lives in SpotifyResource.
//
// generatePlaylist (Iteration 3) is the end-to-end use case: obtain a fresh
// token via UserManagerResource (ADR 0009), run the match, and — only on a
// full cover (ADR 0003: no partial playlists) — create the playlist, add
// tracks in sentence order, and persist history.

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

export type GeneratePlaylistResult =
  | { ok: true; url: string; tracks: MatchedTrack[] }
  | { ok: false; unmatched: string[] };

export interface PlaylistManager {
  matchSentence(
    accessToken: string,
    sentence: string,
  ): Promise<SentenceMatchResult>;
  generatePlaylist(
    userId: string,
    sentence: string,
  ): Promise<GeneratePlaylistResult>;
}

export interface PlaylistManagerDeps {
  sentenceEngine: SentenceEngine;
  spotifyEngine: SpotifyEngine;
  spotifyResource: SpotifyResource;
  userManagerResource?: UserManagerResource;
  playlistResource?: PlaylistResource;
  /** Caps distinct outbound searches per matchSentence call (default 100). */
  maxSearches?: number;
}

// A generous ceiling on distinct Spotify searches per request — the
// backtracking search is memoized per variant, but a long, highly
// substitutable sentence could still fan out far enough to be worth bounding
// so one request can never hammer Spotify unboundedly.
const DEFAULT_MAX_SEARCHES = 100;

export function makePlaylistManager(
  deps: PlaylistManagerDeps,
): PlaylistManager {
  const {
    sentenceEngine,
    spotifyEngine,
    spotifyResource,
    userManagerResource,
    playlistResource,
    maxSearches = DEFAULT_MAX_SEARCHES,
  } = deps;

  async function matchSentence(
    accessToken: string,
    sentence: string,
  ): Promise<SentenceMatchResult> {
    const words = sentenceEngine.tokenize(sentence);
    if (words.length === 0) return { ok: false, unmatched: [] };

    // Backtracking re-derives groupings for the remainder, so the same
    // variant can come up on several paths — search each one only once.
    const matchByVariant = new Map<string, TrackCandidate | null>();
    let searchesUsed = 0;

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
      if (index === deepestFailIndex && !deepestFailPhrases.includes(phrase)) {
        deepestFailPhrases.push(phrase);
      }
    }

    async function findTrack(variant: string): Promise<TrackCandidate | null> {
      const cached = matchByVariant.get(variant);
      if (cached !== undefined) return cached;
      // Budget exhausted: fail this (and any future) lookup without another
      // Spotify call, and cache it so the rest of this request stays consistent.
      if (searchesUsed >= maxSearches) {
        matchByVariant.set(variant, null);
        return null;
      }
      searchesUsed++;
      const results = await spotifyResource.searchTracks(accessToken, variant);
      const match = spotifyEngine.findMatch(variant, results) ?? null;
      matchByVariant.set(variant, match);
      return match;
    }

    // A suffix that could not be covered once can never be covered — the
    // outcome of cover(i) depends only on i. Without this, backtracking
    // re-explores the same failing suffix once per path that reaches it
    // (exponential in sentence length, even with searches memoized).
    const deadEnds = new Set<number>();

    // Depth-first over word positions: cover the words from `index` on, or
    // return null so the caller backtracks to its next candidate.
    async function cover(index: number): Promise<MatchedTrack[] | null> {
      if (index === words.length) return [];
      if (deadEnds.has(index)) return null;

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
        if (rest) return [{ phrase: candidate.phrase, track: match }, ...rest];
      }
      deadEnds.add(index);
      return null;
    }

    const tracks = await cover(0);
    return tracks
      ? { ok: true, tracks }
      : { ok: false, unmatched: deepestFailPhrases };
  }

  return {
    matchSentence,

    async generatePlaylist(userId, sentence) {
      if (!userManagerResource || !playlistResource) {
        throw new Error(
          "generatePlaylist requires userManagerResource and playlistResource",
        );
      }

      const accessToken = await userManagerResource.getFreshAccessToken(userId);
      const result = await matchSentence(accessToken, sentence);
      if (!result.ok) return { ok: false, unmatched: result.unmatched };

      const metadata = spotifyEngine.buildPlaylistMetadata(sentence);
      const spotifyUserId = await spotifyResource.getCurrentUserId(accessToken);
      const playlist = await spotifyResource.createPlaylist(
        accessToken,
        spotifyUserId,
        metadata,
      );
      await spotifyResource.addTracks(
        accessToken,
        playlist.id,
        result.tracks.map(({ track }) => track.uri),
      );
      await playlistResource.save(userId, {
        sentence,
        spotifyPlaylistId: playlist.id,
        url: playlist.url,
        tracks: result.tracks.map(({ phrase, track }) => ({
          phrase,
          trackId: track.id,
          trackUri: track.uri,
          trackName: track.name,
          artistNames: track.artistNames,
        })),
      });

      return { ok: true, url: playlist.url, tracks: result.tracks };
    },
  };
}

/**
 * Wire a PlaylistManager from environment configuration. Lazy by design — see
 * `createUserManager()` for the same rationale (no env read at module import).
 */
export function createPlaylistManager(): PlaylistManager {
  return makePlaylistManager({
    sentenceEngine: createSentenceEngine(),
    spotifyEngine: createSpotifyEngine(),
    spotifyResource: createSpotifyResource(),
    userManagerResource: createUserManagerResource(),
    playlistResource: createPlaylistResource(),
  });
}
