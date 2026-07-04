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
import type { MatchedTrack } from "@/server/playlist/managers/PlaylistManager";
import { assertDisposableTestDb, getPool } from "@/server/shared/db";
import { createSessionToken, SESSION_COOKIE } from "@/server/shared/session";

import { POST as create } from "./route";

// Integration test exercising the create route handler end to end: real
// session signing, real Postgres, with only the Spotify HTTP boundary
// stubbed. Create trusts the client-confirmed tracks (ADR 0012) — it never
// searches, only calls /me, creates the playlist, and adds tracks.

const ME_URL = "https://api.spotify.com/v1/me";

function stubSpotify() {
  const createPlaylistCalls: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === ME_URL) {
        return jsonResponse({ id: "spotify-user-1" });
      }
      if (/\/v1\/users\/[^/]+\/playlists$/.test(url)) {
        createPlaylistCalls.push(JSON.parse(init?.body as string));
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
  return createPlaylistCalls;
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

const helloTrack: MatchedTrack = {
  phrase: "hello",
  track: {
    id: "id-hello",
    uri: "spotify:track:id-hello",
    name: "Hello",
    artistNames: ["Artist"],
  },
};

function createRequest(
  sessionToken: string | undefined,
  body: Record<string, unknown>,
) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (sessionToken) headers.cookie = `${SESSION_COOKIE}=${sessionToken}`;
  return new NextRequest("http://127.0.0.1:3000/api/playlists/create", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

describe("POST /api/playlists/create", () => {
  it("creates a private playlist from the confirmed tracks and records history", async () => {
    stubSpotify();
    const { user, sessionToken } = await seedLoggedInUser();

    const response = await create(
      createRequest(sessionToken, {
        sentence: "Hello!",
        tracks: [helloTrack],
        public: false,
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.url).toBe("https://open.spotify.com/playlist/1");

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

  it("threads public: true to the Spotify create-playlist call", async () => {
    const createPlaylistCalls = stubSpotify();
    const { sessionToken } = await seedLoggedInUser();

    const response = await create(
      createRequest(sessionToken, {
        sentence: "Hello!",
        tracks: [helloTrack],
        public: true,
      }),
    );

    expect(response.status).toBe(200);
    expect(createPlaylistCalls).toEqual([
      expect.objectContaining({ public: true }),
    ]);
  });

  it("returns 401 without a session", async () => {
    stubSpotify();
    const response = await create(
      createRequest(undefined, {
        sentence: "hello",
        tracks: [helloTrack],
        public: false,
      }),
    );
    expect(response.status).toBe(401);
  });

  it("returns 400 for a blank sentence", async () => {
    stubSpotify();
    const { sessionToken } = await seedLoggedInUser();

    const response = await create(
      createRequest(sessionToken, {
        sentence: "   ",
        tracks: [helloTrack],
        public: false,
      }),
    );

    expect(response.status).toBe(400);
  });

  it("returns 400 for an empty tracks list", async () => {
    stubSpotify();
    const { sessionToken } = await seedLoggedInUser();

    const response = await create(
      createRequest(sessionToken, {
        sentence: "hello",
        tracks: [],
        public: false,
      }),
    );

    expect(response.status).toBe(400);
  });

  it("returns 400 for a malformed track shape", async () => {
    stubSpotify();
    const { sessionToken } = await seedLoggedInUser();

    const response = await create(
      createRequest(sessionToken, {
        sentence: "hello",
        tracks: [{ phrase: "hello" }],
        public: false,
      }),
    );

    expect(response.status).toBe(400);
  });

  it("returns 400 when visibility is missing", async () => {
    stubSpotify();
    const { sessionToken } = await seedLoggedInUser();

    const response = await create(
      createRequest(sessionToken, {
        sentence: "hello",
        tracks: [helloTrack],
      }),
    );

    expect(response.status).toBe(400);
  });
});
