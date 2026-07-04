import { describe, expect, it, vi } from "vitest";

import { createSentenceEngine } from "../engines/SentenceEngine";
import { createSpotifyEngine } from "../engines/SpotifyEngine";
import { type TrackCandidate } from "../resources/SpotifyResource";
import { makePlaylistManager } from "./PlaylistManager";

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
      playlistResource: { save: vi.fn() },
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
      playlistResource: { save },
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
