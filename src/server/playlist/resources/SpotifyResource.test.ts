import { describe, expect, it, vi } from "vitest";

import { createSpotifyResource } from "./SpotifyResource";

function searchResponse(
  items: Array<{
    id: string;
    uri: string;
    name: string;
    artists?: Array<{ name: string }>;
  }>,
) {
  return new Response(JSON.stringify({ tracks: { items } }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("SpotifyResource.searchTracks", () => {
  it("calls the search endpoint with the query, track type, and bearer token", async () => {
    const fetchFn = vi.fn().mockResolvedValue(searchResponse([]));
    const resource = createSpotifyResource({ fetchFn });

    await resource.searchTracks("token-123", "love you");

    const [url, init] = fetchFn.mock.calls[0];
    const parsed = new URL(url as string);
    expect(parsed.origin + parsed.pathname).toBe(
      "https://api.spotify.com/v1/search",
    );
    expect(parsed.searchParams.get("q")).toBe("love you");
    expect(parsed.searchParams.get("type")).toBe("track");
    expect(parsed.searchParams.get("limit")).toBe("50");
    expect((init as RequestInit).headers).toEqual({
      Authorization: "Bearer token-123",
    });
    expect((init as RequestInit).signal).toBeInstanceOf(AbortSignal);
  });

  it("URL-encodes special characters in the query", async () => {
    const fetchFn = vi.fn().mockResolvedValue(searchResponse([]));
    const resource = createSpotifyResource({ fetchFn });

    await resource.searchTracks("t", "me & you?");

    const parsed = new URL(fetchFn.mock.calls[0][0] as string);
    expect(parsed.searchParams.get("q")).toBe("me & you?");
  });

  it("maps the response to the TrackCandidate slice", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      searchResponse([
        {
          id: "id1",
          uri: "spotify:track:id1",
          name: "Love You",
          artists: [{ name: "A" }, { name: "B" }],
        },
        { id: "id2", uri: "spotify:track:id2", name: "Love U" },
      ]),
    );
    const resource = createSpotifyResource({ fetchFn });

    const tracks = await resource.searchTracks("t", "love you");

    expect(tracks).toEqual([
      {
        id: "id1",
        uri: "spotify:track:id1",
        name: "Love You",
        artistNames: ["A", "B"],
      },
      { id: "id2", uri: "spotify:track:id2", name: "Love U", artistNames: [] },
    ]);
  });

  it("returns an empty list when the response has no items", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(new Response("{}", { status: 200 }));
    const resource = createSpotifyResource({ fetchFn });

    expect(await resource.searchTracks("t", "love you")).toEqual([]);
  });

  it("throws with status and detail on a non-OK response (after the 429 retry is exhausted)", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(new Response("rate limited", { status: 429 }));
    const resource = createSpotifyResource({
      fetchFn,
      sleep: vi.fn().mockResolvedValue(undefined),
    });

    await expect(resource.searchTracks("t", "love you")).rejects.toThrow(
      /429.*rate limited/,
    );
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("throws immediately on a non-429, non-OK response — no retry", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(new Response("nope", { status: 403 }));
    const resource = createSpotifyResource({ fetchFn });

    await expect(resource.searchTracks("t", "love you")).rejects.toThrow(
      /403.*nope/,
    );
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("retries once after a 429 with Retry-After, then succeeds", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("rate limited", {
          status: 429,
          headers: { "Retry-After": "2" },
        }),
      )
      .mockResolvedValueOnce(searchResponse([]));
    const resource = createSpotifyResource({ fetchFn, sleep });

    await resource.searchTracks("t", "love you");

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it("falls back to a default wait when Retry-After is missing", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(new Response("rate limited", { status: 429 }))
      .mockResolvedValueOnce(searchResponse([]));
    const resource = createSpotifyResource({ fetchFn, sleep });

    await resource.searchTracks("t", "love you");

    expect(sleep).toHaveBeenCalledWith(1000);
  });
});

describe("SpotifyResource.getCurrentUserId", () => {
  it("fetches /v1/me with the bearer token and returns the id", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ id: "spotify-user-1" }), { status: 200 }),
      );
    const resource = createSpotifyResource({ fetchFn });

    const id = await resource.getCurrentUserId("token-123");

    expect(id).toBe("spotify-user-1");
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe("https://api.spotify.com/v1/me");
    expect((init as RequestInit).headers).toEqual({
      Authorization: "Bearer token-123",
    });
  });
});

describe("SpotifyResource.createPlaylist", () => {
  it("POSTs to the user's playlists endpoint and returns id + url", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "playlist-1",
          external_urls: { spotify: "https://open.spotify.com/playlist/1" },
        }),
        { status: 201 },
      ),
    );
    const resource = createSpotifyResource({ fetchFn });

    const result = await resource.createPlaylist("token-123", "user-1", {
      name: "I will always love you",
      description: "made with Say It With a Playlist",
    });

    expect(result).toEqual({
      id: "playlist-1",
      url: "https://open.spotify.com/playlist/1",
    });
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe("https://api.spotify.com/v1/users/user-1/playlists");
    const req = init as RequestInit;
    expect(req.method).toBe("POST");
    expect(JSON.parse(req.body as string)).toEqual({
      name: "I will always love you",
      description: "made with Say It With a Playlist",
      public: false,
    });
  });

  it("sends public: true when isPublic is passed", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ id: "playlist-1", external_urls: {} }),
        { status: 201 },
      ),
    );
    const resource = createSpotifyResource({ fetchFn });

    await resource.createPlaylist(
      "token-123",
      "user-1",
      { name: "n", description: "d" },
      true,
    );

    const req = fetchFn.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(req.body as string)).toMatchObject({ public: true });
  });

  it("URL-encodes the Spotify user id", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "p1", external_urls: {} }), {
        status: 201,
      }),
    );
    const resource = createSpotifyResource({ fetchFn });

    await resource.createPlaylist("t", "user name/with slash", {
      name: "n",
      description: "d",
    });

    const url = fetchFn.mock.calls[0][0] as string;
    expect(url).toBe(
      "https://api.spotify.com/v1/users/user%20name%2Fwith%20slash/playlists",
    );
  });
});

describe("SpotifyResource.addTracks", () => {
  it("POSTs the track uris in order to the playlist's tracks endpoint", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(new Response("{}", { status: 201 }));
    const resource = createSpotifyResource({ fetchFn });

    await resource.addTracks("token-123", "playlist-1", [
      "spotify:track:a",
      "spotify:track:b",
    ]);

    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe("https://api.spotify.com/v1/playlists/playlist-1/tracks");
    const req = init as RequestInit;
    expect(req.method).toBe("POST");
    expect(JSON.parse(req.body as string)).toEqual({
      uris: ["spotify:track:a", "spotify:track:b"],
    });
  });
});
