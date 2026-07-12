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
  SEARCH_LIMIT,
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
      /** ADR 0003: no full cover ⇒ no playlist; report what to reword.
       * Always the single word the search got stuck on (empty only when the
       * sentence itself was blank) — see ADR 0015: the deepest position any
       * backtracking path reached is provably where that word's own 1-word
       * candidate missed, so there is exactly one word to blame, not a list
       * of every grouping that was tried on the way there. */
      ok: false;
      unmatched: string[];
      /** Whether the stuck word is a genuine no-match, or the maxSearches
       * budget ran out before the search could finish (ADR 0015) — without
       * this, a give-up reads identically to "no song is titled this," and
       * the user is told to reword a word when the app simply stopped
       * looking. */
      reason: "no_match" | "budget";
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
  /** Candidates at or under this word count get a page-2 retry on a page-1
   * miss (default 1 — see ADR 0015: a live probe found bare tiny words
   * ("a", "i", "the") have an exact-title track sitting on Spotify's second
   * results page, while multi-word phrases never benefited from it). */
  deepSearchMaxWords?: number;
}

// A generous ceiling on distinct Spotify searches per request — the
// backtracking search is memoized per variant, but a long, highly
// substitutable sentence could still fan out far enough to be worth bounding
// so one request can never hammer Spotify unboundedly.
const DEFAULT_MAX_SEARCHES = 100;

const DEFAULT_DEEP_SEARCH_MAX_WORDS = 1;

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
    deepSearchMaxWords = DEFAULT_DEEP_SEARCH_MAX_WORDS,
  } = deps;

  async function matchSentence(
    accessToken: string,
    sentence: string,
    onProgress?: OnProgress,
  ): Promise<SentenceMatchResult> {
    const words = sentenceEngine.tokenize(sentence);
    onProgress?.({ type: "tokenised", words: words.length, tokens: words });
    if (words.length === 0) {
      const result: SentenceMatchResult = {
        ok: false,
        unmatched: [],
        reason: "no_match",
      };
      onProgress?.({ type: "done", searches: 0, ...result });
      return result;
    }

    // Backtracking re-derives groupings for the remainder, so the same
    // variant can come up on several paths — search each one only once.
    const matchByVariant = new Map<string, TrackCandidate | null>();
    let searchesUsed = 0;
    // Set the moment a lookup is *denied* a search it wanted to make, so a
    // give-up can never be reported as a confident "no song is titled this"
    // (ADR 0015). Request-scoped rather than per-position: the depth-first
    // search reaches deep positions early, so a genuine miss recorded there
    // before the budget ran out would otherwise mask the give-up that
    // followed. Distinct from `searchesUsed >= maxSearches`, which is also
    // true of a search that finished exhaustively and merely spent its last
    // search doing so.
    let budgetDenied = false;

    // Failure report (ADR 0015): the word position of the deepest point any
    // backtracking path reached. That position's own 1-word candidate is
    // provably the thing that failed there — if it had hit, its remainder
    // would have failed deeper, contradicting "deepest" — so there is always
    // exactly one word to blame, never a list of every grouping tried on the
    // way there. Only 1-word misses are recorded, since a longer span that
    // misses always has a shorter candidate left to try at the same index.
    let deepestFailIndex = -1;

    function recordFailure(index: number) {
      if (index > deepestFailIndex) deepestFailIndex = index;
    }

    async function findTrack(
      variant: string,
      wordCount: number,
    ): Promise<TrackCandidate | null> {
      const cached = matchByVariant.get(variant);
      if (cached !== undefined) return cached;
      // Budget exhausted: fail this (and any future) lookup without another
      // Spotify call, and cache it so the rest of this request stays
      // consistent. This is a give-up, not a confirmed absence — record that,
      // so the terminal result can say so.
      if (searchesUsed >= maxSearches) {
        budgetDenied = true;
        matchByVariant.set(variant, null);
        return null;
      }
      searchesUsed++;
      const page0 = await spotifyResource.searchTracks(accessToken, variant);
      let match = spotifyEngine.findMatch(variant, page0) ?? null;

      // Deepen only for bare/short candidates. A live probe (ADR 0015) found
      // every tiny word ("a", "i", "the") that missed page 1 had an
      // exact-title track on page 2, while multi-word phrases never
      // benefited from it — a real title of any length already ranks highly
      // in Spotify's own search, so there is nothing to gain by paging
      // further for those. The second page is a second outbound call, so it
      // is metered against the same budget.
      if (!match && wordCount <= deepSearchMaxWords) {
        if (searchesUsed >= maxSearches) {
          // Wanted page 2 and was refused: this null is a give-up too.
          budgetDenied = true;
        } else {
          searchesUsed++;
          const page1 = await spotifyResource.searchTracks(
            accessToken,
            variant,
            SEARCH_LIMIT,
          );
          match = spotifyEngine.findMatch(variant, page1) ?? null;
        }
      }

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
          match = await findTrack(variant, candidate.wordCount);
          if (match) break;
        }
        if (!match) {
          if (!hasShorterCandidate) recordFailure(index);
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
    // A failed cover in which some lookup was refused a search is not an
    // exhaustive no-match: groupings that might have covered the sentence were
    // never tried. Say so, rather than blaming the deepest word the search
    // happened to reach before it gave up (ADR 0015).
    const result: SentenceMatchResult = tracks
      ? { ok: true, tracks }
      : {
          ok: false,
          unmatched: [words[deepestFailIndex]],
          reason: budgetDenied ? "budget" : "no_match",
        };
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
