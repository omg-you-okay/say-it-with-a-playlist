// SpotifyResource — access to the Spotify Web API (search, for now). Typed,
// hand-rolled fetch against the documented REST endpoints — deliberately no
// SDK (ADR 0011). The access token arrives as a call argument: token
// acquisition/refresh is Identity's job, reached via the UserManagerResource
// adapter by PlaylistManager (ADR 0009) — never by this Resource.

const SEARCH_URL = "https://api.spotify.com/v1/search";

// Node's fetch has no practical default timeout; a hung Spotify call would
// otherwise hang the whole generate request.
const REQUEST_TIMEOUT_MS = 10_000;

// Spotify's maximum page size — exact-after-normalization matching is strict,
// so give findMatch the widest net a single request allows.
const SEARCH_LIMIT = 50;

/** The slice of a Spotify track object the app actually uses. */
export interface TrackCandidate {
  id: string;
  uri: string;
  name: string;
  artistNames: string[];
}

interface SpotifySearchResponse {
  tracks?: {
    items?: Array<{
      id: string;
      uri: string;
      name: string;
      artists?: Array<{ name: string }>;
    }>;
  };
}

export interface SpotifyResource {
  searchTracks(accessToken: string, query: string): Promise<TrackCandidate[]>;
}

export interface SpotifyResourceConfig {
  fetchFn?: typeof fetch;
}

export function createSpotifyResource(
  config: SpotifyResourceConfig = {},
): SpotifyResource {
  const fetchFn = config.fetchFn ?? fetch;

  return {
    async searchTracks(accessToken, query) {
      const params = new URLSearchParams({
        q: query,
        type: "track",
        limit: String(SEARCH_LIMIT),
      });
      const res = await fetchFn(`${SEARCH_URL}?${params.toString()}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(
          `Spotify search request failed (${res.status}): ${detail}`,
        );
      }
      const body = (await res.json()) as SpotifySearchResponse;
      return (body.tracks?.items ?? []).map((item) => ({
        id: item.id,
        uri: item.uri,
        name: item.name,
        artistNames: (item.artists ?? []).map((artist) => artist.name),
      }));
    },
  };
}
