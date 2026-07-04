// SpotifyResource — access to the Spotify Web API (search, playlist
// create/add, current-user lookup). Typed, hand-rolled fetch against the
// documented REST endpoints — deliberately no SDK (ADR 0011). The access
// token arrives as a call argument: token acquisition/refresh is Identity's
// job, reached via the UserManagerResource adapter by PlaylistManager
// (ADR 0009) — never by this Resource.

const SEARCH_URL = "https://api.spotify.com/v1/search";
const ME_URL = "https://api.spotify.com/v1/me";

function playlistsUrl(spotifyUserId: string): string {
  return `https://api.spotify.com/v1/users/${encodeURIComponent(spotifyUserId)}/playlists`;
}

function playlistTracksUrl(playlistId: string): string {
  return `https://api.spotify.com/v1/playlists/${encodeURIComponent(playlistId)}/tracks`;
}

// Node's fetch has no practical default timeout; a hung Spotify call would
// otherwise hang the whole generate request.
const REQUEST_TIMEOUT_MS = 10_000;

// Spotify's maximum page size — exact-after-normalization matching is strict,
// so give findMatch the widest net a single request allows.
const SEARCH_LIMIT = 50;

// A single retry on 429 covers the occasional rate-limit spike hit during a
// backtracking search without turning one request into an unbounded loop.
const MAX_RETRY_ATTEMPTS = 1;

// Fallback wait when Spotify omits Retry-After (documented as always present
// on 429s, but defensive since a missing header must not mean "retry forever
// instantly").
const DEFAULT_RETRY_AFTER_MS = 1_000;

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

interface SpotifyMeResponse {
  id: string;
}

interface SpotifyPlaylistResponse {
  id: string;
  external_urls?: { spotify?: string };
}

export interface CreatedPlaylist {
  id: string;
  url: string;
}

export interface PlaylistMetadataInput {
  name: string;
  description: string;
}

export interface SpotifyResource {
  searchTracks(accessToken: string, query: string): Promise<TrackCandidate[]>;
  /** The Spotify user id of the token's owner — needed to create a playlist on their account. */
  getCurrentUserId(accessToken: string): Promise<string>;
  createPlaylist(
    accessToken: string,
    spotifyUserId: string,
    metadata: PlaylistMetadataInput,
  ): Promise<CreatedPlaylist>;
  /** Adds tracks in the given order. Callers must keep `uris` at or under Spotify's 100-per-call cap. */
  addTracks(
    accessToken: string,
    playlistId: string,
    uris: string[],
  ): Promise<void>;
}

export interface SpotifyResourceConfig {
  fetchFn?: typeof fetch;
  /** Injectable for hermetic 429-retry tests; defaults to a real timer. */
  sleep?: (ms: number) => Promise<void>;
}

export function createSpotifyResource(
  config: SpotifyResourceConfig = {},
): SpotifyResource {
  const fetchFn = config.fetchFn ?? fetch;
  const sleep =
    config.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  function retryAfterMs(res: Response): number {
    const header = res.headers.get("Retry-After");
    const seconds = header ? Number(header) : NaN;
    return Number.isFinite(seconds) ? seconds * 1000 : DEFAULT_RETRY_AFTER_MS;
  }

  async function spotifyFetch(
    url: string,
    accessToken: string,
    init: RequestInit = {},
  ): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const res = await fetchFn(url, {
        ...init,
        headers: { ...init.headers, Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (res.status === 429 && attempt < MAX_RETRY_ATTEMPTS) {
        await sleep(retryAfterMs(res));
        continue;
      }
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(`Spotify request failed (${res.status}): ${detail}`);
      }
      return res;
    }
  }

  return {
    async searchTracks(accessToken, query) {
      const params = new URLSearchParams({
        q: query,
        type: "track",
        limit: String(SEARCH_LIMIT),
      });
      const res = await spotifyFetch(
        `${SEARCH_URL}?${params.toString()}`,
        accessToken,
      );
      const body = (await res.json()) as SpotifySearchResponse;
      return (body.tracks?.items ?? []).map((item) => ({
        id: item.id,
        uri: item.uri,
        name: item.name,
        artistNames: (item.artists ?? []).map((artist) => artist.name),
      }));
    },

    async getCurrentUserId(accessToken) {
      const res = await spotifyFetch(ME_URL, accessToken);
      const body = (await res.json()) as SpotifyMeResponse;
      return body.id;
    },

    async createPlaylist(accessToken, spotifyUserId, metadata) {
      const res = await spotifyFetch(playlistsUrl(spotifyUserId), accessToken, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: metadata.name,
          description: metadata.description,
          public: false,
        }),
      });
      const body = (await res.json()) as SpotifyPlaylistResponse;
      return { id: body.id, url: body.external_urls?.spotify ?? "" };
    },

    async addTracks(accessToken, playlistId, uris) {
      await spotifyFetch(playlistTracksUrl(playlistId), accessToken, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uris }),
      });
    },
  };
}
