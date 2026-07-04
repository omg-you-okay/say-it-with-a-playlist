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

  it("throws with status and detail on a non-OK response", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(new Response("rate limited", { status: 429 }));
    const resource = createSpotifyResource({ fetchFn });

    await expect(resource.searchTracks("t", "love you")).rejects.toThrow(
      /429.*rate limited/,
    );
  });
});
