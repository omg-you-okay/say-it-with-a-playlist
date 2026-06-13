import { describe, expect, it, vi } from "vitest";

import { createAuthEngine } from "./AuthEngine";

const config = {
  clientId: "client-abc",
  clientSecret: "secret-xyz",
  redirectUri: "http://127.0.0.1:3000/api/auth/callback",
};

function okJson(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

function errorResponse(status: number, detail: string) {
  return {
    ok: false,
    status,
    json: async () => ({}),
    text: async () => detail,
  } as Response;
}

describe("AuthEngine.generateState", () => {
  it("returns a 32-char hex string that differs each call", () => {
    const engine = createAuthEngine(config);
    const a = engine.generateState();
    const b = engine.generateState();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(a).not.toBe(b);
  });
});

describe("AuthEngine.buildAuthorizeUrl", () => {
  it("builds the Spotify authorize URL with code flow, scopes, and state", () => {
    const engine = createAuthEngine(config);
    const url = new URL(engine.buildAuthorizeUrl("state-123"));

    expect(url.origin + url.pathname).toBe(
      "https://accounts.spotify.com/authorize",
    );
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("client-abc");
    expect(url.searchParams.get("redirect_uri")).toBe(config.redirectUri);
    expect(url.searchParams.get("state")).toBe("state-123");
    expect(url.searchParams.get("scope")).toContain("playlist-modify-private");
    expect(url.searchParams.get("scope")).toContain("user-read-email");
  });

  it("honors custom scopes when provided", () => {
    const engine = createAuthEngine({ ...config, scopes: ["only-this"] });
    const url = new URL(engine.buildAuthorizeUrl("s"));
    expect(url.searchParams.get("scope")).toBe("only-this");
  });
});

describe("AuthEngine.exchangeCode", () => {
  it("posts the auth code with Basic auth and normalizes the token set", async () => {
    const fetchFn = vi.fn<
      (url: string, init: RequestInit) => Promise<Response>
    >(async () =>
      okJson({
        access_token: "access-1",
        token_type: "Bearer",
        scope: "user-read-email",
        expires_in: 3600,
        refresh_token: "refresh-1",
      }),
    );
    const engine = createAuthEngine({
      ...config,
      fetchFn: fetchFn as unknown as typeof fetch,
      now: () => 1_000_000,
    });

    const tokens = await engine.exchangeCode("the-code");

    expect(tokens).toEqual({
      accessToken: "access-1",
      refreshToken: "refresh-1",
      scope: "user-read-email",
      tokenType: "Bearer",
      expiresAt: new Date(1_000_000 + 3600 * 1000),
    });

    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe("https://accounts.spotify.com/api/token");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(
      "Basic " + Buffer.from("client-abc:secret-xyz").toString("base64"),
    );
    const body = new URLSearchParams(init.body as string);
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("the-code");
    expect(body.get("redirect_uri")).toBe(config.redirectUri);
  });

  it("throws with the status and body when Spotify rejects the code", async () => {
    const fetchFn = vi.fn<
      (url: string, init: RequestInit) => Promise<Response>
    >(async () => errorResponse(400, "invalid_grant"));
    const engine = createAuthEngine({
      ...config,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    await expect(engine.exchangeCode("bad")).rejects.toThrow(
      /400.*invalid_grant/,
    );
  });
});

describe("AuthEngine.refreshAccessToken", () => {
  it("keeps the existing refresh token when Spotify omits a new one", async () => {
    const fetchFn = vi.fn<
      (url: string, init: RequestInit) => Promise<Response>
    >(async () =>
      okJson({
        access_token: "access-2",
        token_type: "Bearer",
        scope: "user-read-email",
        expires_in: 3600,
        // no refresh_token in the response
      }),
    );
    const engine = createAuthEngine({
      ...config,
      fetchFn: fetchFn as unknown as typeof fetch,
      now: () => 0,
    });

    const tokens = await engine.refreshAccessToken("old-refresh");
    expect(tokens.accessToken).toBe("access-2");
    expect(tokens.refreshToken).toBe("old-refresh");

    const body = new URLSearchParams(fetchFn.mock.calls[0][1].body as string);
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("old-refresh");
  });

  it("uses the rotated refresh token when Spotify returns one", async () => {
    const fetchFn = vi.fn<
      (url: string, init: RequestInit) => Promise<Response>
    >(async () =>
      okJson({
        access_token: "access-3",
        token_type: "Bearer",
        scope: "user-read-email",
        expires_in: 3600,
        refresh_token: "rotated-refresh",
      }),
    );
    const engine = createAuthEngine({
      ...config,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    const tokens = await engine.refreshAccessToken("old-refresh");
    expect(tokens.refreshToken).toBe("rotated-refresh");
  });
});

describe("AuthEngine.fetchProfile", () => {
  it("normalizes the profile, coercing missing fields to null", async () => {
    const fetchFn = vi.fn<
      (url: string, init: RequestInit) => Promise<Response>
    >(async () => okJson({ id: "spotify-9" }));
    const engine = createAuthEngine({
      ...config,
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    const profile = await engine.fetchProfile("access-token");
    expect(profile).toEqual({
      spotifyUserId: "spotify-9",
      displayName: null,
      email: null,
    });

    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe("https://api.spotify.com/v1/me");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer access-token",
    );
  });

  it("throws when the profile request fails", async () => {
    const fetchFn = vi.fn<
      (url: string, init: RequestInit) => Promise<Response>
    >(async () => errorResponse(401, "expired"));
    const engine = createAuthEngine({
      ...config,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    await expect(engine.fetchProfile("bad")).rejects.toThrow(/401.*expired/);
  });
});
