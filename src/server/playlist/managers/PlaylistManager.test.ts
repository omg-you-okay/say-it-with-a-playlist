import { describe, expect, it, vi } from "vitest";

import { createSentenceEngine } from "../engines/SentenceEngine";
import { createSpotifyEngine } from "../engines/SpotifyEngine";
import { type TrackCandidate } from "../resources/SpotifyResource";
import { makePlaylistManager, type PreviewEvent } from "./PlaylistManager";

// The engines are real — these tests exercise the whole decomposition core.
// Only the Spotify search is mocked (roadmap: Iteration 2 mocks the search):
// the catalog maps a search query to the track titles it returns.

function track(name: string): TrackCandidate {
  return {
    id: `id-${name}`,
    uri: `spotify:track:id-${name}`,
    name,
    artistNames: ["Artist"],
  };
}

// matchSentence never calls these — they exist only to satisfy the
// SpotifyResource type for tests that don't exercise generatePlaylist.
const unusedSpotifyWriteMethods = {
  getCurrentUserId: vi.fn(),
  createPlaylist: vi.fn(),
  addTracks: vi.fn(),
};

function makeManager(catalog: Record<string, string[]>) {
  const searchTracks = vi.fn(async (_token: string, query: string) =>
    (catalog[query] ?? []).map(track),
  );
  const manager = makePlaylistManager({
    sentenceEngine: createSentenceEngine(),
    spotifyEngine: createSpotifyEngine(),
    spotifyResource: { searchTracks, ...unusedSpotifyWriteMethods },
  });
  return { manager, searchTracks };
}

function titles(result: { ok: true; tracks: { track: TrackCandidate }[] }) {
  return result.tracks.map(({ track }) => track.name);
}

describe("PlaylistManager.matchSentence", () => {
  it("matches a single-word sentence", async () => {
    const { manager } = makeManager({ hello: ["Hello"] });

    const result = await manager.matchSentence("tok", "Hello!");

    expect(result).toEqual({
      ok: true,
      tracks: [{ phrase: "hello", track: track("Hello") }],
    });
  });

  it("prefers the longest grouping — one track for the whole sentence", async () => {
    const { manager, searchTracks } = makeManager({
      "always love you": ["Always Love You"],
    });

    const result = await manager.matchSentence("tok", "Always love you");

    expect(result.ok).toBe(true);
    if (result.ok) expect(titles(result)).toEqual(["Always Love You"]);
    // Longest candidate matched immediately — nothing shorter was searched.
    expect(searchTracks).toHaveBeenCalledTimes(1);
  });

  it("falls back to shorter groupings and re-derives the remainder", async () => {
    const { manager } = makeManager({
      "i will": ["I Will"],
      "always love you": ["Always Love You (Remastered 2011)"],
    });

    const result = await manager.matchSentence("tok", "I will always love you");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.tracks.map((t) => t.phrase)).toEqual([
        "i will",
        "always love you",
      ]);
      expect(titles(result)).toEqual([
        "I Will",
        "Always Love You (Remastered 2011)",
      ]);
    }
  });

  it("backtracks out of a matched grouping that leads to a dead end", async () => {
    // "red blue" matches but leaves "green" uncoverable; the loop must undo
    // that choice and take "red" + "blue green" instead.
    const { manager } = makeManager({
      "red blue": ["Red Blue"],
      red: ["Red"],
      "blue green": ["Blue Green"],
    });

    const result = await manager.matchSentence("tok", "red blue green");

    expect(result.ok).toBe(true);
    if (result.ok) expect(titles(result)).toEqual(["Red", "Blue Green"]);
  });

  it("matches through substitution variants (ADR 0003)", async () => {
    const { manager } = makeManager({ "love u": ["Love U"] });

    const result = await manager.matchSentence("tok", "love you");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(titles(result)).toEqual(["Love U"]);
      // The result still reports the phrase as the user wrote it.
      expect(result.tracks[0].phrase).toBe("love you");
    }
  });

  it("rejects search results that are not exact matches", async () => {
    const { manager } = makeManager({ "love you": ["Love You Baby"] });

    const result = await manager.matchSentence("tok", "love you");

    expect(result.ok).toBe(false);
  });

  it("reports the unmatched phrases instead of creating a partial cover", async () => {
    const { manager } = makeManager({ love: ["Love"] });

    const result = await manager.matchSentence("tok", "love xyzzy");

    // "love" itself matched — the report points at the actual blocker.
    expect(result).toEqual({ ok: false, unmatched: ["xyzzy"] });
  });

  it("reports every failed grouping at the blocking position", async () => {
    const { manager } = makeManager({});

    const result = await manager.matchSentence("tok", "xyzzy love");

    expect(result).toEqual({
      ok: false,
      unmatched: ["xyzzy love", "xyzzy"],
    });
  });

  it("searches each variant only once across backtracking paths", async () => {
    // Both the [sun moon] and [sun][moon] paths reach "star"; the second
    // arrival must hit the memo, not Spotify.
    const { manager, searchTracks } = makeManager({
      sun: ["Sun"],
      moon: ["Moon"],
      "sun moon": ["Sun Moon"],
    });

    const result = await manager.matchSentence("tok", "sun moon star");

    expect(result).toEqual({ ok: false, unmatched: ["star"] });
    const starSearches = searchTracks.mock.calls.filter(
      ([, query]) => query === "star",
    );
    expect(starSearches).toHaveLength(1);
  });

  it("abandons a failed suffix permanently instead of re-exploring it", async () => {
    // Both the [sun moon] and [sun][moon] paths reach position 2; the second
    // arrival must hit the dead-end memo, not re-derive candidates (that
    // re-exploration is exponential in sentence length).
    const sentenceEngine = createSentenceEngine();
    const candidatesAt = vi.fn(sentenceEngine.candidatesAt);
    const catalog: Record<string, string[]> = {
      sun: ["Sun"],
      moon: ["Moon"],
      "sun moon": ["Sun Moon"],
    };
    const manager = makePlaylistManager({
      sentenceEngine: { ...sentenceEngine, candidatesAt },
      spotifyEngine: createSpotifyEngine(),
      spotifyResource: {
        searchTracks: async (_token, query) =>
          (catalog[query] ?? []).map(track),
        ...unusedSpotifyWriteMethods,
      },
    });

    const result = await manager.matchSentence("tok", "sun moon star");

    expect(result.ok).toBe(false);
    const callsAtStar = candidatesAt.mock.calls.filter(
      ([, index]) => index === 2,
    );
    expect(callsAtStar).toHaveLength(1);
  });

  it("passes the access token through to the search", async () => {
    const { manager, searchTracks } = makeManager({ hello: ["Hello"] });

    await manager.matchSentence("tok-42", "hello");

    expect(searchTracks).toHaveBeenCalledWith("tok-42", "hello");
  });

  it("fails an empty sentence without searching", async () => {
    const { manager, searchTracks } = makeManager({});

    const result = await manager.matchSentence("tok", "   ");

    expect(result).toEqual({ ok: false, unmatched: [] });
    expect(searchTracks).not.toHaveBeenCalled();
  });

  it("stops searching once the search budget is exhausted and fails gracefully", async () => {
    const searchTracks = vi.fn(async () => []);
    const manager = makePlaylistManager({
      sentenceEngine: createSentenceEngine(),
      spotifyEngine: createSpotifyEngine(),
      spotifyResource: { searchTracks, ...unusedSpotifyWriteMethods },
      maxSearches: 2,
    });

    const result = await manager.matchSentence("tok", "one two three");

    expect(result.ok).toBe(false);
    expect(searchTracks).toHaveBeenCalledTimes(2);
  });
});

describe("PlaylistManager.matchSentence progress events (ADR 0013)", () => {
  function collect(): {
    onProgress: (event: PreviewEvent) => void;
    events: PreviewEvent[];
  } {
    const events: PreviewEvent[] = [];
    return { onProgress: (event) => events.push(event), events };
  }

  it("emits tokenised → try → hit → done for a clean single-candidate match", async () => {
    const { manager } = makeManager({ hello: ["Hello"] });
    const { onProgress, events } = collect();

    await manager.matchSentence("tok", "Hello!", onProgress);

    expect(events).toEqual([
      { type: "tokenised", words: 1 },
      { type: "try", index: 0, phrase: "hello", words: 1 },
      {
        type: "hit",
        index: 0,
        phrase: "hello",
        wordCount: 1,
        track: track("Hello"),
      },
      {
        type: "done",
        ok: true,
        tracks: [{ phrase: "hello", track: track("Hello") }],
      },
    ]);
  });

  it("emits miss + split while backtracking to a shorter grouping", async () => {
    const { manager } = makeManager({
      "i will": ["I Will"],
      "always love you": ["Always Love You"],
    });
    const { onProgress, events } = collect();

    await manager.matchSentence("tok", "I will always love you", onProgress);

    const misses = events.filter((e) => e.type === "miss");
    expect(misses.map((e) => e.phrase)).toEqual([
      "i will always love you",
      "i will always love",
      "i will always",
    ]);
    // Each miss has a shorter grouping left to try, so each is followed by a split.
    const splits = events.filter((e) => e.type === "split");
    expect(splits).toHaveLength(3);
    expect(splits[0]).toEqual({
      type: "split",
      index: 0,
      phrase: "i will always love you",
    });

    const hits = events.filter((e) => e.type === "hit");
    expect(hits).toEqual([
      {
        type: "hit",
        index: 0,
        phrase: "i will",
        wordCount: 2,
        track: track("I Will"),
      },
      {
        type: "hit",
        index: 2,
        phrase: "always love you",
        wordCount: 3,
        track: track("Always Love You"),
      },
    ]);
  });

  it("emits a split when a hit is undone by a downstream dead end", async () => {
    // Same fixture as the "backtracks out of a matched grouping" test above:
    // "red blue" hits but strands "green", so the loop must undo that hit.
    const { manager } = makeManager({
      "red blue": ["Red Blue"],
      red: ["Red"],
      "blue green": ["Blue Green"],
    });
    const { onProgress, events } = collect();

    await manager.matchSentence("tok", "red blue green", onProgress);

    const hitPhrases = events
      .filter((e) => e.type === "hit")
      .map((e) => e.phrase);
    // "red blue" is hit, then undone (its remainder — "green" alone — dead-ends).
    expect(hitPhrases).toEqual(["red blue", "red", "blue green"]);

    const splits = events.filter((e) => e.type === "split");
    expect(splits).toContainEqual({
      type: "split",
      index: 0,
      phrase: "red blue",
    });
  });

  it("emits a terminal done:false with the unmatched phrases", async () => {
    const { manager } = makeManager({});
    const { onProgress, events } = collect();

    await manager.matchSentence("tok", "xyzzy", onProgress);

    expect(events.at(-1)).toEqual({
      type: "done",
      ok: false,
      unmatched: ["xyzzy"],
    });
  });

  it("emits no split for an undone hit that was the last candidate at its position", async () => {
    // The case the client's prune rule has to survive. At index 1 the
    // candidates are ["blue green", "blue"]. "blue green" misses (emitting a
    // split), then "blue" — the LAST candidate — hits, and its remainder
    // ("green") dead-ends. With no shorter grouping left to break into, NO
    // split is emitted for "blue": the loop just gives up on index 1. So the
    // only split at index 1 fires *before* the hit it would need to undo. A
    // client pruning on `split` alone would strand "blue"'s track on screen;
    // pruning on the next `try` is what actually clears it — see the
    // prune-on-try rule in PlaylistGenerator.
    const { manager } = makeManager({
      red: ["Red"],
      blue: ["Blue"],
      "red blue": ["Red Blue"],
    });
    const { onProgress, events } = collect();

    const result = await manager.matchSentence(
      "tok",
      "red blue green",
      onProgress,
    );

    expect(result.ok).toBe(false);
    // "blue" hit at index 1, and its remainder then dead-ended...
    expect(events).toContainEqual({
      type: "hit",
      index: 1,
      phrase: "blue",
      wordCount: 1,
      track: track("Blue"),
    });
    // ...yet no split ever names "blue", so nothing tells a split-pruning
    // client to drop it.
    const splitPhrases = events
      .filter((e) => e.type === "split")
      .map((e) => e.phrase);
    expect(splitPhrases).not.toContain("blue");
  });

  it("stays silent when no callback is given (existing callers unaffected)", async () => {
    const { manager } = makeManager({ hello: ["Hello"] });

    // No third argument — must not throw, must behave exactly as before.
    const result = await manager.matchSentence("tok", "hello");

    expect(result.ok).toBe(true);
  });
});

describe("PlaylistManager.previewSentence", () => {
  function makePreviewDeps(catalog: Record<string, string[]>) {
    const searchTracks = vi.fn(async (_token: string, query: string) =>
      (catalog[query] ?? []).map(track),
    );
    const getFreshAccessToken = vi.fn().mockResolvedValue("fresh-token");

    const manager = makePlaylistManager({
      sentenceEngine: createSentenceEngine(),
      spotifyEngine: createSpotifyEngine(),
      spotifyResource: { searchTracks, ...unusedSpotifyWriteMethods },
      userManagerResource: { getFreshAccessToken },
      playlistResource: { save: vi.fn(), listByUser: vi.fn() },
    });

    return { manager, searchTracks, getFreshAccessToken };
  }

  it("acquires a fresh token and returns the matched tracks, creating nothing", async () => {
    const deps = makePreviewDeps({
      "i will": ["I Will"],
      "always love you": ["Always Love You"],
    });

    const result = await deps.manager.previewSentence(
      "user-1",
      "I will always love you",
    );

    expect(deps.getFreshAccessToken).toHaveBeenCalledWith("user-1");
    expect(deps.searchTracks).toHaveBeenCalledWith("fresh-token", "i will");
    expect(result).toEqual({
      ok: true,
      tracks: [
        { phrase: "i will", track: track("I Will") },
        { phrase: "always love you", track: track("Always Love You") },
      ],
    });
    expect(unusedSpotifyWriteMethods.createPlaylist).not.toHaveBeenCalled();
    expect(unusedSpotifyWriteMethods.addTracks).not.toHaveBeenCalled();
  });

  it("reports unmatched phrases on a no-match sentence (ADR 0003)", async () => {
    const deps = makePreviewDeps({});

    const result = await deps.manager.previewSentence("user-1", "xyzzy");

    expect(result).toEqual({ ok: false, unmatched: ["xyzzy"] });
  });

  it("propagates a token-acquisition failure without searching", async () => {
    const deps = makePreviewDeps({ hello: ["Hello"] });
    deps.getFreshAccessToken.mockRejectedValue(new Error("no tokens"));

    await expect(
      deps.manager.previewSentence("user-1", "hello"),
    ).rejects.toThrow("no tokens");
    expect(deps.searchTracks).not.toHaveBeenCalled();
  });

  it("forwards onProgress through to the underlying match (ADR 0013)", async () => {
    const deps = makePreviewDeps({ hello: ["Hello"] });
    const events: PreviewEvent[] = [];

    await deps.manager.previewSentence("user-1", "hello", (event) =>
      events.push(event),
    );

    expect(events.map((e) => e.type)).toEqual([
      "tokenised",
      "try",
      "hit",
      "done",
    ]);
  });
});

describe("PlaylistManager.createFromTracks", () => {
  function makeCreateDeps() {
    const searchTracks = vi.fn();
    const getCurrentUserId = vi.fn().mockResolvedValue("spotify-user-1");
    const createPlaylist = vi.fn().mockResolvedValue({
      id: "playlist-1",
      url: "https://open.spotify.com/playlist/1",
    });
    const addTracks = vi.fn().mockResolvedValue(undefined);
    const getFreshAccessToken = vi.fn().mockResolvedValue("fresh-token");
    const save = vi.fn().mockResolvedValue(undefined);

    const manager = makePlaylistManager({
      sentenceEngine: createSentenceEngine(),
      spotifyEngine: createSpotifyEngine(),
      spotifyResource: {
        searchTracks,
        getCurrentUserId,
        createPlaylist,
        addTracks,
      },
      userManagerResource: { getFreshAccessToken },
      playlistResource: { save, listByUser: vi.fn() },
    });

    return {
      manager,
      searchTracks,
      getCurrentUserId,
      createPlaylist,
      addTracks,
      getFreshAccessToken,
      save,
    };
  }

  const confirmedTracks = [
    { phrase: "i will", track: track("I Will") },
    { phrase: "always love you", track: track("Always Love You") },
  ];

  it("creates a private playlist from the confirmed tracks, adds them in order, and saves history", async () => {
    const deps = makeCreateDeps();

    const result = await deps.manager.createFromTracks(
      "user-1",
      "I will always love you",
      confirmedTracks,
      false,
    );

    expect(deps.getFreshAccessToken).toHaveBeenCalledWith("user-1");
    expect(deps.getCurrentUserId).toHaveBeenCalledWith("fresh-token");
    expect(deps.createPlaylist).toHaveBeenCalledWith(
      "fresh-token",
      "spotify-user-1",
      {
        name: "I will always love you",
        description:
          "Read the track titles in order — made with Say It With a Playlist",
      },
      false,
    );
    expect(deps.addTracks).toHaveBeenCalledWith("fresh-token", "playlist-1", [
      "spotify:track:id-I Will",
      "spotify:track:id-Always Love You",
    ]);
    expect(deps.save).toHaveBeenCalledWith("user-1", {
      sentence: "I will always love you",
      spotifyPlaylistId: "playlist-1",
      url: "https://open.spotify.com/playlist/1",
      tracks: [
        {
          phrase: "i will",
          trackId: "id-I Will",
          trackUri: "spotify:track:id-I Will",
          trackName: "I Will",
          artistNames: ["Artist"],
        },
        {
          phrase: "always love you",
          trackId: "id-Always Love You",
          trackUri: "spotify:track:id-Always Love You",
          trackName: "Always Love You",
          artistNames: ["Artist"],
        },
      ],
    });
    expect(result).toEqual({
      ok: true,
      url: "https://open.spotify.com/playlist/1",
    });
    // create trusts the client-confirmed tracks — no re-search (ADR 0012).
    expect(deps.searchTracks).not.toHaveBeenCalled();
  });

  it("threads isPublic: true through to createPlaylist", async () => {
    const deps = makeCreateDeps();

    await deps.manager.createFromTracks(
      "user-1",
      "hello",
      [{ phrase: "hello", track: track("Hello") }],
      true,
    );

    expect(deps.createPlaylist).toHaveBeenCalledWith(
      "fresh-token",
      "spotify-user-1",
      expect.any(Object),
      true,
    );
  });

  it("propagates a token-acquisition failure without creating anything", async () => {
    const deps = makeCreateDeps();
    deps.getFreshAccessToken.mockRejectedValue(new Error("no tokens"));

    await expect(
      deps.manager.createFromTracks("user-1", "hello", confirmedTracks, false),
    ).rejects.toThrow("no tokens");
    expect(deps.createPlaylist).not.toHaveBeenCalled();
  });
});

describe("PlaylistManager.getHistory", () => {
  it("passes the userId through and returns the resource's entries as-is", async () => {
    const entries = [
      {
        id: "entry-1",
        sentence: "Hello!",
        url: "https://open.spotify.com/playlist/1",
        tracks: [],
        createdAt: new Date("2030-01-01T00:00:00.000Z"),
      },
    ];
    const listByUser = vi.fn().mockResolvedValue(entries);
    const manager = makePlaylistManager({
      sentenceEngine: createSentenceEngine(),
      spotifyEngine: createSpotifyEngine(),
      spotifyResource: {
        searchTracks: vi.fn(),
        ...unusedSpotifyWriteMethods,
      },
      playlistResource: { save: vi.fn(), listByUser },
    });

    const result = await manager.getHistory("user-1");

    expect(listByUser).toHaveBeenCalledWith("user-1");
    expect(result).toBe(entries);
  });

  it("throws a clear wiring error when playlistResource is missing", async () => {
    const manager = makePlaylistManager({
      sentenceEngine: createSentenceEngine(),
      spotifyEngine: createSpotifyEngine(),
      spotifyResource: {
        searchTracks: vi.fn(),
        ...unusedSpotifyWriteMethods,
      },
    });

    await expect(manager.getHistory("user-1")).rejects.toThrow(
      "getHistory requires playlistResource",
    );
  });
});
