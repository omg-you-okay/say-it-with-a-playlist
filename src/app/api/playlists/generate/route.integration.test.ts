import { NextRequest } from "next/server";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { createTokenResource } from "@/server/identity/resources/TokenResource";
import { createUserResource } from "@/server/identity/resources/UserResource";
import { assertDisposableTestDb, getPool } from "@/server/shared/db";
import { createSessionToken, SESSION_COOKIE } from "@/server/shared/session";

import { POST as generate } from "./route";

// Integration test exercising the generate route handler end to end: real
// session signing, real Postgres, with only the Spotify HTTP boundary
// stubbed (same pattern as auth-routes.integration.test.ts).

const SEARCH_URL = "https://api.spotify.com/v1/search";
const ME_URL = "https://api.spotify.com/v1/me";

/** Stub global fetch: `catalog` maps a search query to the track titles it returns. */
function stubSpotify(catalog: Record<string, string[]>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith(SEARCH_URL)) {
        const q = new URL(url).searchParams.get("q") ?? "";
        const items = (catalog[q] ?? []).map((name, i) => ({
          id: `id-${q}-${i}`,
          uri: `spotify:track:id-${q}-${i}`,
          name,
          artists: [{ name: "Artist" }],
        }));
        return jsonResponse({ tracks: { items } });
      }
      if (url === ME_URL) {
        return jsonResponse({ id: "spotify-user-1" });
      }
      if (/\/v1\/users\/[^/]+\/playlists$/.test(url)) {
        return jsonResponse(
          {
            id: "playlist-1",
            external_urls: { spotify: "https://open.spotify.com/playlist/1" },
          },
          201,
        );
      }
      if (/\/v1\/playlists\/[^/]+\/tracks$/.test(url)) {
        return jsonResponse({}, 201);
      }
      throw new Error(`unexpected fetch to ${url} (${init?.method ?? "GET"})`);
    }),
  );
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeAll(() => {
  process.env.SPOTIFY_CLIENT_ID = "client-abc";
  process.env.SPOTIFY_CLIENT_SECRET = "secret-xyz";
  process.env.SPOTIFY_REDIRECT_URI = "http://127.0.0.1:3000/api/auth/callback";
  process.env.SESSION_SECRET = "test-secret-at-least-32-bytes-long-xx";
  process.env.DATABASE_URL ??=
    "postgresql://postgres:postgres@127.0.0.1:5432/say_it_with_a_playlist";
  assertDisposableTestDb(process.env.DATABASE_URL);
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await getPool().query("TRUNCATE users CASCADE");
});

afterAll(async () => {
  await getPool().end();
});

async function seedLoggedInUser() {
  const users = createUserResource();
  const tokens = createTokenResource();
  const user = await users.upsertBySpotifyId({
    spotifyUserId: "spotify-owner",
    displayName: "Ada",
    email: "ada@example.com",
  });
  await tokens.save(user.id, {
    accessToken: "access-1",
    refreshToken: "refresh-1",
    scope: "playlist-modify-private",
    tokenType: "Bearer",
    expiresAt: new Date(Date.now() + 60 * 60 * 1000), // fresh, no refresh needed
  });
  const sessionToken = await createSessionToken(user.id);
  return { user, sessionToken };
}

function generateRequest(sessionToken: string | undefined, sentence: unknown) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (sessionToken) headers.cookie = `${SESSION_COOKIE}=${sessionToken}`;
  return new NextRequest("http://127.0.0.1:3000/api/playlists/generate", {
    method: "POST",
    headers,
    body: JSON.stringify({ sentence }),
  });
}

describe("POST /api/playlists/generate", () => {
  it("creates a playlist, adds tracks in order, and records history", async () => {
    stubSpotify({ hello: ["Hello"] });
    const { user, sessionToken } = await seedLoggedInUser();

    const response = await generate(generateRequest(sessionToken, "Hello!"));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.url).toBe("https://open.spotify.com/playlist/1");
    expect(body.tracks).toEqual([
      {
        phrase: "hello",
        track: {
          id: "id-hello-0",
          uri: "spotify:track:id-hello-0",
          name: "Hello",
          artistNames: ["Artist"],
        },
      },
    ]);

    const { rows } = await getPool().query(
      "SELECT sentence, spotify_playlist_id, url FROM playlists WHERE user_id = $1",
      [user.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      sentence: "Hello!",
      spotify_playlist_id: "playlist-1",
      url: "https://open.spotify.com/playlist/1",
    });
  });

  it("returns 401 without a session", async () => {
    stubSpotify({});
    const response = await generate(generateRequest(undefined, "hello"));
    expect(response.status).toBe(401);
  });

  it("returns 422 and creates nothing on a no-match sentence", async () => {
    stubSpotify({});
    const { user, sessionToken } = await seedLoggedInUser();

    const response = await generate(generateRequest(sessionToken, "xyzzy"));

    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.unmatched).toEqual(["xyzzy"]);

    const { rows } = await getPool().query(
      "SELECT 1 FROM playlists WHERE user_id = $1",
      [user.id],
    );
    expect(rows).toHaveLength(0);
  });

  it("returns 400 for a blank sentence", async () => {
    stubSpotify({});
    const { sessionToken } = await seedLoggedInUser();

    const response = await generate(generateRequest(sessionToken, "   "));

    expect(response.status).toBe(400);
  });
});
