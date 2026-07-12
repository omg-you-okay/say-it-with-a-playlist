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

import { POST as preview } from "./route";

// Integration test exercising the preview route handler end to end: real
// session signing, real Postgres, with only the Spotify HTTP boundary
// stubbed (same pattern as auth-routes.integration.test.ts). Preview only
// searches — it must never reach the playlist-creation endpoints.

const SEARCH_URL = "https://api.spotify.com/v1/search";

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

function previewRequest(sessionToken: string | undefined, sentence: unknown) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (sessionToken) headers.cookie = `${SESSION_COOKIE}=${sessionToken}`;
  return new NextRequest("http://127.0.0.1:3000/api/playlists/preview", {
    method: "POST",
    headers,
    body: JSON.stringify({ sentence }),
  });
}

// The route streams NDJSON (ADR 0013) — read the whole body and split it back
// into the events the Manager emitted, in order.
async function readEvents(
  response: Response,
): Promise<Record<string, unknown>[]> {
  const text = await response.text();
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line));
}

describe("POST /api/playlists/preview", () => {
  it("streams progress and a terminal done event with the matched tracks, creating nothing", async () => {
    stubSpotify({ hello: ["Hello"] });
    const { user, sessionToken } = await seedLoggedInUser();

    const response = await preview(previewRequest(sessionToken, "Hello!"));

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/x-ndjson");
    const events = await readEvents(response);

    expect(events[0]).toEqual({ type: "tokenised", words: 1 });
    expect(events.at(-1)).toEqual({
      type: "done",
      ok: true,
      tracks: [
        {
          phrase: "hello",
          track: {
            id: "id-hello-0",
            uri: "spotify:track:id-hello-0",
            name: "Hello",
            artistNames: ["Artist"],
          },
        },
      ],
    });

    const { rows } = await getPool().query(
      "SELECT 1 FROM playlists WHERE user_id = $1",
      [user.id],
    );
    expect(rows).toHaveLength(0);
  });

  it("returns 401 without a session", async () => {
    stubSpotify({});
    const response = await preview(previewRequest(undefined, "hello"));
    expect(response.status).toBe(401);
  });

  it("streams a terminal done:false with the unmatched phrases on a no-match sentence", async () => {
    stubSpotify({});
    const { sessionToken } = await seedLoggedInUser();

    const response = await preview(previewRequest(sessionToken, "xyzzy"));

    // ADR 0013: no full cover is a terminal event, not a status code — the
    // 200 and headers are already on the wire by the time the matcher knows.
    expect(response.status).toBe(200);
    const events = await readEvents(response);
    expect(events.at(-1)).toEqual({
      type: "done",
      ok: false,
      unmatched: ["xyzzy"],
    });
  });

  it("returns 400 for a blank sentence", async () => {
    stubSpotify({});
    const { sessionToken } = await seedLoggedInUser();

    const response = await preview(previewRequest(sessionToken, "   "));

    expect(response.status).toBe(400);
  });
});
