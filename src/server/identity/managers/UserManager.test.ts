import { describe, expect, it, vi } from "vitest";

import type { AuthEngine, SpotifyTokenSet } from "../engines/AuthEngine";
import type { StoredTokens, TokenResource } from "../resources/TokenResource";
import type { AppUser, UserResource } from "../resources/UserResource";
import {
  makeUserManager,
  MissingTokensError,
  OAuthStateMismatchError,
  type UserManagerDeps,
} from "./UserManager";

function tokenSet(overrides: Partial<SpotifyTokenSet> = {}): SpotifyTokenSet {
  return {
    accessToken: "access-1",
    refreshToken: "refresh-1",
    scope: "user-read-email",
    tokenType: "Bearer",
    expiresAt: new Date("2030-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function makeDeps(overrides: Partial<UserManagerDeps> = {}): {
  deps: UserManagerDeps;
  authEngine: { [K in keyof AuthEngine]: ReturnType<typeof vi.fn> };
  userResource: {
    upsertBySpotifyId: ReturnType<typeof vi.fn>;
    findById: ReturnType<typeof vi.fn>;
  };
  tokenResource: {
    save: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
  };
  createSession: ReturnType<typeof vi.fn>;
} {
  const authEngine = {
    generateState: vi.fn(() => "state-xyz"),
    buildAuthorizeUrl: vi.fn((s: string) => `https://authorize?state=${s}`),
    exchangeCode: vi.fn(async () => tokenSet()),
    refreshAccessToken: vi.fn(async () =>
      tokenSet({ accessToken: "access-2", refreshToken: "refresh-2" }),
    ),
    fetchProfile: vi.fn(async () => ({
      spotifyUserId: "spotify-1",
      displayName: "Ada",
      email: "ada@example.com",
    })),
  };
  const user: AppUser = {
    id: "user-1",
    spotifyUserId: "spotify-1",
    displayName: "Ada",
    email: "ada@example.com",
  };
  const userResource = {
    upsertBySpotifyId: vi.fn(async () => user),
    findById: vi.fn(async (): Promise<AppUser | null> => user),
  };
  const tokenResource = {
    save: vi.fn(async () => {}),
    get: vi.fn(async (): Promise<StoredTokens | null> => null),
  };
  const createSession = vi.fn(async (id: string) => `session-for-${id}`);

  return {
    deps: {
      authEngine: authEngine as unknown as AuthEngine,
      userResource: userResource as unknown as UserResource,
      tokenResource: tokenResource as unknown as TokenResource,
      createSession,
      ...overrides,
    },
    authEngine,
    userResource,
    tokenResource,
    createSession,
  };
}

describe("UserManager.beginLogin", () => {
  it("generates a state and builds the authorize URL from it", () => {
    const { deps, authEngine } = makeDeps();
    const result = makeUserManager(deps).beginLogin();
    expect(result.state).toBe("state-xyz");
    expect(authEngine.buildAuthorizeUrl).toHaveBeenCalledWith("state-xyz");
    expect(result.authorizeUrl).toBe("https://authorize?state=state-xyz");
  });
});

describe("UserManager.handleCallback", () => {
  it("rejects a mismatched state without exchanging the code", async () => {
    const { deps, authEngine } = makeDeps();
    await expect(
      makeUserManager(deps).handleCallback({
        code: "c",
        state: "from-spotify",
        storedState: "different",
      }),
    ).rejects.toBeInstanceOf(OAuthStateMismatchError);
    expect(authEngine.exchangeCode).not.toHaveBeenCalled();
  });

  it("rejects when no state cookie was stored", async () => {
    const { deps } = makeDeps();
    await expect(
      makeUserManager(deps).handleCallback({
        code: "c",
        state: "from-spotify",
        storedState: undefined,
      }),
    ).rejects.toBeInstanceOf(OAuthStateMismatchError);
  });

  it("exchanges, upserts the user, stores tokens, and mints a session", async () => {
    const { deps, authEngine, userResource, tokenResource, createSession } =
      makeDeps();
    const result = await makeUserManager(deps).handleCallback({
      code: "the-code",
      state: "match",
      storedState: "match",
    });

    expect(authEngine.exchangeCode).toHaveBeenCalledWith("the-code");
    expect(authEngine.fetchProfile).toHaveBeenCalledWith("access-1");
    expect(userResource.upsertBySpotifyId).toHaveBeenCalledWith({
      spotifyUserId: "spotify-1",
      displayName: "Ada",
      email: "ada@example.com",
    });
    expect(tokenResource.save).toHaveBeenCalledWith("user-1", tokenSet());
    expect(createSession).toHaveBeenCalledWith("user-1");
    expect(result).toEqual({
      userId: "user-1",
      sessionToken: "session-for-user-1",
    });
  });
});

describe("UserManager.getFreshAccessToken", () => {
  it("throws when the user has no stored tokens", async () => {
    const { deps } = makeDeps();
    await expect(
      makeUserManager(deps).getFreshAccessToken("user-1"),
    ).rejects.toBeInstanceOf(MissingTokensError);
  });

  it("returns the stored token without refreshing when it is still valid", async () => {
    const { deps, tokenResource, authEngine } = makeDeps({
      now: () => new Date("2029-01-01T00:00:00.000Z").getTime(),
    });
    tokenResource.get.mockResolvedValue(
      tokenSet({ accessToken: "still-good" }) as StoredTokens,
    );

    const token = await makeUserManager(deps).getFreshAccessToken("user-1");
    expect(token).toBe("still-good");
    expect(authEngine.refreshAccessToken).not.toHaveBeenCalled();
  });

  it("refreshes and persists when the token is within the expiry skew", async () => {
    const { deps, tokenResource, authEngine } = makeDeps({
      now: () => new Date("2030-01-01T00:00:00.000Z").getTime(), // exactly at expiry
    });
    tokenResource.get.mockResolvedValue(
      tokenSet({ accessToken: "expired" }) as StoredTokens,
    );

    const token = await makeUserManager(deps).getFreshAccessToken("user-1");
    expect(authEngine.refreshAccessToken).toHaveBeenCalledWith("refresh-1");
    expect(token).toBe("access-2");
    expect(tokenResource.save).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ accessToken: "access-2" }),
    );
  });
});

describe("UserManager.getProfile", () => {
  it("returns only the public-facing fields, not the email or Spotify id", async () => {
    const { deps } = makeDeps();
    const profile = await makeUserManager(deps).getProfile("user-1");
    expect(profile).toEqual({ id: "user-1", displayName: "Ada" });
  });

  it("returns null for an unknown user rather than throwing", async () => {
    const { deps, userResource } = makeDeps();
    userResource.findById.mockResolvedValue(null);
    await expect(
      makeUserManager(deps).getProfile("nobody"),
    ).resolves.toBeNull();
  });
});
