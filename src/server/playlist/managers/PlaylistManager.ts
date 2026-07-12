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
  type PlaylistHistoryEntry,
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
// Iteration 4 splits the former one-shot generatePlaylist into two use cases
// (ADR 0012), so the frontend can show matched tracks before anything is
// created:
//   - previewSentence: fresh token (UserManagerResource, ADR 0009) → match →
//     return tracks/unmatched. Nothing created, no history.
//   - createFromTracks: build the playlist from client-confirmed tracks (the
//     ones just previewed) + chosen visibility, add in sentence order, and
//     persist history. No second Spotify search.

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

export type PreviewResult = SentenceMatchResult;

export type CreatePlaylistResult = { ok: true; url: string };

// PreviewEvent — the backtracking loop's progress, live (ADR 0013). The
// Manager emits these through an optional callback as it works; the preview
// route adapts them into an NDJSON stream. `index` is the word position each
// event concerns, so a client can place/un-place chips positionally even as
// the loop backtracks — an event's `index`/`phrase` describe the candidate
// grouping the loop is currently trying at that position, not necessarily
// part of the eventual answer.
export type PreviewEvent =
  // `tokens` is the normalized word list the loop actually works on. The client
  // needs it to show the part of the sentence not yet reached, and cannot
  // derive it: re-splitting the raw sentence in the browser would duplicate
  // SentenceEngine's normalization and drift from it. `words` (the count) is
  // kept alongside it rather than replaced — ADR 0013 locked that field, and
  // widening the event additively is the same move Chunk 1 made for `index`.
  | { type: "tokenised"; words: number; tokens: string[] }
  | { type: "try"; index: number; phrase: string; words: number }
  | {
      type: "hit";
      index: number;
      phrase: string;
      wordCount: number;
      track: TrackCandidate;
    }
  | { type: "miss"; index: number; phrase: string }
  | { type: "split"; index: number; phrase: string }
  // `searches` is the count of *distinct outbound Spotify searches* this
  // request actually spent — the same number the maxSearches budget meters.
  // The client cannot derive it: the per-request memo means a repeated phrase
  // emits a `try` without searching again, so counting `try` events would
  // overstate the real cost.
  | ({ type: "done"; searches: number } & SentenceMatchResult);

export type OnProgress = (event: PreviewEvent) => void;

export interface PlaylistManager {
  matchSentence(
    accessToken: string,
    sentence: string,
    onProgress?: OnProgress,
  ): Promise<SentenceMatchResult>;
  /** Decompose + match only — creates nothing (Iteration 4 preview step). */
  previewSentence(
    userId: string,
    sentence: string,
    onProgress?: OnProgress,
  ): Promise<PreviewResult>;
  /**
   * Build the playlist from client-confirmed tracks (the ones just
   * previewed) at the chosen visibility, add them in sentence order, and
   * persist history. Trusts the caller's track list rather than re-matching.
   */
  createFromTracks(
    userId: string,
    sentence: string,
    tracks: MatchedTrack[],
    isPublic: boolean,
  ): Promise<CreatePlaylistResult>;
  /** Newest-first history of previously created playlists (Iteration 5). */
  getHistory(userId: string): Promise<PlaylistHistoryEntry[]>;
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
    onProgress?: OnProgress,
  ): Promise<SentenceMatchResult> {
    const words = sentenceEngine.tokenize(sentence);
    onProgress?.({ type: "tokenised", words: words.length, tokens: words });
    if (words.length === 0) {
      const result: SentenceMatchResult = { ok: false, unmatched: [] };
      onProgress?.({ type: "done", searches: 0, ...result });
      return result;
    }

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

      const candidates = sentenceEngine.candidatesAt(words, index);
      for (let i = 0; i < candidates.length; i++) {
        const candidate = candidates[i];
        const hasShorterCandidate = i < candidates.length - 1;
        onProgress?.({
          type: "try",
          index,
          phrase: candidate.phrase,
          words: candidate.wordCount,
        });

        let match: TrackCandidate | null = null;
        for (const variant of candidate.variants) {
          match = await findTrack(variant);
          if (match) break;
        }
        if (!match) {
          recordFailure(index, candidate.phrase);
          onProgress?.({ type: "miss", index, phrase: candidate.phrase });
          if (hasShorterCandidate) {
            onProgress?.({ type: "split", index, phrase: candidate.phrase });
          }
          continue;
        }

        onProgress?.({
          type: "hit",
          index,
          phrase: candidate.phrase,
          wordCount: candidate.wordCount,
          track: match,
        });
        const rest = await cover(index + candidate.wordCount);
        if (rest) return [{ phrase: candidate.phrase, track: match }, ...rest];
        if (hasShorterCandidate) {
          onProgress?.({ type: "split", index, phrase: candidate.phrase });
        }
      }
      deadEnds.add(index);
      return null;
    }

    const tracks = await cover(0);
    const result: SentenceMatchResult = tracks
      ? { ok: true, tracks }
      : { ok: false, unmatched: deepestFailPhrases };
    onProgress?.({ type: "done", searches: searchesUsed, ...result });
    return result;
  }

  function requireCrossSubsystemDeps(): {
    userManagerResource: UserManagerResource;
    playlistResource: PlaylistResource;
  } {
    if (!userManagerResource || !playlistResource) {
      throw new Error(
        "previewSentence/createFromTracks require userManagerResource and playlistResource",
      );
    }
    return { userManagerResource, playlistResource };
  }

  function requirePlaylistResource(): PlaylistResource {
    if (!playlistResource) {
      throw new Error("getHistory requires playlistResource");
    }
    return playlistResource;
  }

  return {
    matchSentence,

    async previewSentence(userId, sentence, onProgress) {
      const { userManagerResource } = requireCrossSubsystemDeps();
      const accessToken = await userManagerResource.getFreshAccessToken(userId);
      return matchSentence(accessToken, sentence, onProgress);
    },

    async createFromTracks(userId, sentence, tracks, isPublic) {
      const { userManagerResource, playlistResource } =
        requireCrossSubsystemDeps();
      const accessToken = await userManagerResource.getFreshAccessToken(userId);

      const metadata = spotifyEngine.buildPlaylistMetadata(sentence);
      const spotifyUserId = await spotifyResource.getCurrentUserId(accessToken);
      const playlist = await spotifyResource.createPlaylist(
        accessToken,
        spotifyUserId,
        metadata,
        isPublic,
      );
      await spotifyResource.addTracks(
        accessToken,
        playlist.id,
        tracks.map(({ track }) => track.uri),
      );
      await playlistResource.save(userId, {
        sentence,
        spotifyPlaylistId: playlist.id,
        url: playlist.url,
        tracks: tracks.map(({ phrase, track }) => ({
          phrase,
          trackId: track.id,
          trackUri: track.uri,
          trackName: track.name,
          artistNames: track.artistNames,
        })),
      });

      return { ok: true, url: playlist.url };
    },

    async getHistory(userId) {
      return requirePlaylistResource().listByUser(userId);
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
