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

function makeManager(catalog: Record<string, string[]>) {
  const searchTracks = vi.fn(async (_token: string, query: string) =>
    (catalog[query] ?? []).map(track),
  );
  const manager = makePlaylistManager({
    sentenceEngine: createSentenceEngine(),
    spotifyEngine: createSpotifyEngine(),
    spotifyResource: { searchTracks },
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
});
