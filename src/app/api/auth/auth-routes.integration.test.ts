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

import { OAUTH_STATE_COOKIE } from "@/server/shared/cookies";
import { assertDisposableTestDb, getPool } from "@/server/shared/db";
import { readSessionToken, SESSION_COOKIE } from "@/server/shared/session";

import { GET as callback } from "./callback/route";
import { GET as login } from "./login/route";
import { POST as logout } from "./logout/route";

// Integration tests exercising the auth route handlers end to end: real session
// signing, real Postgres, with only the Spotify HTTP boundary stubbed.

const TOKEN_URL = "https://accounts.spotify.com/api/token";
const PROFILE_URL = "https://api.spotify.com/v1/me";

/** Stub global fetch so AuthEngine sees a successful token + profile exchange. */
function stubSpotify(profile: { id: string; email?: string }) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url === TOKEN_URL) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            access_token: "access-1",
            token_type: "Bearer",
            scope: "user-read-email",
            expires_in: 3600,
            refresh_token: "refresh-1",
          }),
          text: async () => "",
        } as Response;
      }
      if (url === PROFILE_URL) {
        return {
          ok: true,
          status: 200,
          json: async () => profile,
          text: async () => "",
        } as Response;
      }
      throw new Error(`unexpected fetch to ${url}`);
    }),
  );
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

describe("GET /api/auth/login", () => {
  it("redirects to Spotify and sets the state cookie", async () => {
    const response = await login();

    expect(response.status).toBe(307);
    const location = response.headers.get("location")!;
    expect(location).toContain("https://accounts.spotify.com/authorize");

    const stateCookie = response.cookies.get(OAUTH_STATE_COOKIE);
    expect(stateCookie?.value).toBeTruthy();
    expect(stateCookie?.httpOnly).toBe(true);
    // The cookie state must match the state in the redirect URL.
    const urlState = new URL(location).searchParams.get("state");
    expect(urlState).toBe(stateCookie?.value);
  });
});

describe("GET /api/auth/callback", () => {
  function callbackRequest(query: string, stateCookie?: string) {
    const headers = stateCookie
      ? { cookie: `${OAUTH_STATE_COOKIE}=${stateCookie}` }
      : undefined;
    return new NextRequest(`http://127.0.0.1:3000/api/auth/callback?${query}`, {
      headers,
    });
  }

  it("logs the user in: stores them and sets a valid session cookie", async () => {
    stubSpotify({ id: "spotify-new", email: "new@example.com" });

    const response = await callback(
      callbackRequest("code=the-code&state=match", "match"),
    );

    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/");
    expect(location.searchParams.get("auth_error")).toBeNull();

    const session = response.cookies.get(SESSION_COOKIE);
    expect(session?.value).toBeTruthy();
    expect(session?.httpOnly).toBe(true);
    // The session cookie is a valid signed token carrying the app user id.
    const userId = await readSessionToken(session?.value);
    expect(userId).toMatch(/^[0-9a-f-]{36}$/);

    // The user and their tokens were persisted.
    const { rows } = await getPool().query(
      "SELECT u.id FROM users u JOIN spotify_tokens t ON t.user_id = u.id WHERE u.spotify_user_id = $1",
      ["spotify-new"],
    );
    expect(rows).toHaveLength(1);

    // The transient state cookie is cleared.
    expect(response.cookies.get(OAUTH_STATE_COOKIE)?.value).toBe("");
  });

  it("rejects a mismatched state without setting a session", async () => {
    const response = await callback(
      callbackRequest("code=the-code&state=from-spotify", "different"),
    );
    expect(response.headers.get("location")).toContain(
      "auth_error=state_mismatch",
    );
    expect(response.cookies.get(SESSION_COOKIE)?.value).toBeFalsy();
  });

  it("redirects with an error when Spotify denies consent", async () => {
    const response = await callback(callbackRequest("error=access_denied"));
    expect(response.headers.get("location")).toContain(
      "auth_error=access_denied",
    );
  });

  it("collapses an unknown/attacker-controlled error code to a fixed value", async () => {
    const response = await callback(callbackRequest("error=phishy"));
    expect(response.headers.get("location")).toContain(
      "auth_error=spotify_error",
    );
  });

  it("redirects with an error when required params are missing", async () => {
    const response = await callback(callbackRequest("state=only-state"));
    expect(response.headers.get("location")).toContain(
      "auth_error=missing_params",
    );
  });

  it("pins the redirect to the real Host header, not request.url", async () => {
    // Reproduces the `next dev` quirk: `request.url` resolves to `localhost`
    // while the browser actually hit `127.0.0.1` (the Host header). The
    // redirect must follow the header so the session cookie isn't stranded on a
    // different origin.
    const request = new NextRequest(
      "http://localhost:3000/api/auth/callback?error=access_denied",
      { headers: { host: "127.0.0.1:3000" } },
    );
    const response = await callback(request);
    const location = new URL(response.headers.get("location")!);
    expect(location.host).toBe("127.0.0.1:3000");
  });
});

describe("POST /api/auth/logout", () => {
  it("clears the session cookie", async () => {
    const response = await logout();
    const body = await response.json();
    expect(body).toEqual({ ok: true });
    const cleared = response.cookies.get(SESSION_COOKIE);
    expect(cleared?.value).toBe("");
    expect(cleared?.maxAge).toBe(0);
  });
});
