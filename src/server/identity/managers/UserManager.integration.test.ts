import { Pool } from "pg";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { assertDisposableTestDb } from "@/server/shared/db";

import type { AuthEngine, SpotifyTokenSet } from "../engines/AuthEngine";
import { createTokenResource } from "../resources/TokenResource";
import { createUserResource } from "../resources/UserResource";
import { makeUserManager } from "./UserManager";

// Token refresh against a *real* Postgres, because the thing under test is the
// row lock in `TokenResource.withLockedTokens` — and a fake resource cannot
// serialize anything. The unit tests in UserManager.test.ts cover the decision
// logic; this file covers the concurrency it exists to survive (ADR 0017).

const connectionString =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:5432/say_it_with_a_playlist";

assertDisposableTestDb(connectionString);

const pool = new Pool({ connectionString });
const users = createUserResource(pool);
const tokens = createTokenResource(pool);

beforeAll(async () => {
  await pool.query("SELECT 1"); // fail fast if the DB is unreachable
});

afterEach(async () => {
  await pool.query("TRUNCATE users CASCADE");
});

afterAll(async () => {
  await pool.end();
});

const HOUR_MS = 60 * 60 * 1000;

function tokenSet(overrides: Partial<SpotifyTokenSet> = {}): SpotifyTokenSet {
  return {
    accessToken: "fresh-access",
    refreshToken: "rotated-refresh",
    scope: "user-read-email",
    tokenType: "Bearer",
    expiresAt: new Date(Date.now() + HOUR_MS),
    ...overrides,
  };
}

async function makeUserWithExpiredTokens() {
  const user = await users.upsertBySpotifyId({
    spotifyUserId: "spotify-refresh-race",
    displayName: null,
    email: null,
  });
  await tokens.save(user.id, {
    accessToken: "stale-access",
    refreshToken: "original-refresh",
    scope: "user-read-email",
    tokenType: "Bearer",
    expiresAt: new Date(Date.now() - HOUR_MS), // already expired
  });
  return user;
}

describe("UserManager.getFreshAccessToken under concurrency", () => {
  it("refreshes exactly once when two callers race on an expired token", async () => {
    const user = await makeUserWithExpiredTokens();

    // Spotify rotates the refresh token, and is slow enough that two unlocked
    // callers would certainly overlap. Without the row lock, both would read the
    // expired row, both would refresh with `original-refresh`, and the loser
    // would write its result over the winner's.
    const refreshAccessToken = vi.fn(async (): Promise<SpotifyTokenSet> => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return tokenSet();
    });
    const authEngine = { refreshAccessToken } as unknown as AuthEngine;

    const manager = makeUserManager({
      authEngine,
      userResource: users,
      tokenResource: tokens,
    });

    const [first, second] = await Promise.all([
      manager.getFreshAccessToken(user.id),
      manager.getFreshAccessToken(user.id),
    ]);

    // The loser of the race must not have burned a second refresh: it blocked on
    // the lock, re-read the row, and found the winner's token already there.
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(refreshAccessToken).toHaveBeenCalledWith("original-refresh");

    // Both callers get the same live token, and the rotated refresh token
    // survives in the database — this is the assertion that fails when the
    // loser clobbers the winner.
    expect(first).toBe("fresh-access");
    expect(second).toBe("fresh-access");
    const stored = await tokens.get(user.id);
    expect(stored?.accessToken).toBe("fresh-access");
    expect(stored?.refreshToken).toBe("rotated-refresh");
  });

  it("does not refresh at all when the stored token is still fresh", async () => {
    const user = await users.upsertBySpotifyId({
      spotifyUserId: "spotify-fresh",
      displayName: null,
      email: null,
    });
    await tokens.save(user.id, {
      accessToken: "still-good",
      refreshToken: "original-refresh",
      scope: "user-read-email",
      tokenType: "Bearer",
      expiresAt: new Date(Date.now() + HOUR_MS),
    });

    const refreshAccessToken = vi.fn(async () => tokenSet());
    const manager = makeUserManager({
      authEngine: { refreshAccessToken } as unknown as AuthEngine,
      userResource: users,
      tokenResource: tokens,
    });

    await expect(manager.getFreshAccessToken(user.id)).resolves.toBe(
      "still-good",
    );
    // The common path must not pay for a lock, let alone a Spotify round trip.
    expect(refreshAccessToken).not.toHaveBeenCalled();
  });

  it("releases the lock when the refresh throws, leaving the row untouched", async () => {
    const user = await makeUserWithExpiredTokens();

    const failing = makeUserManager({
      authEngine: {
        refreshAccessToken: vi.fn(async () => {
          throw new Error("spotify is down");
        }),
      } as unknown as AuthEngine,
      userResource: users,
      tokenResource: tokens,
    });
    await expect(failing.getFreshAccessToken(user.id)).rejects.toThrow(
      "spotify is down",
    );

    // The transaction rolled back, so the original tokens are still intact...
    const stored = await tokens.get(user.id);
    expect(stored?.refreshToken).toBe("original-refresh");
    expect(stored?.accessToken).toBe("stale-access");

    // ...and, crucially, the row is not still locked by an abandoned
    // transaction: a later caller can take it and succeed. (This would hang and
    // time out if the failed transaction leaked its client.)
    const recovering = makeUserManager({
      authEngine: {
        refreshAccessToken: vi.fn(async () => tokenSet()),
      } as unknown as AuthEngine,
      userResource: users,
      tokenResource: tokens,
    });
    await expect(recovering.getFreshAccessToken(user.id)).resolves.toBe(
      "fresh-access",
    );
  });
});
