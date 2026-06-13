import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { createTokenResource } from "./TokenResource";
import { createUserResource } from "./UserResource";

// Integration tests against a real Postgres (local `pnpm db:up`, or the
// postgres service in CI). They exercise the actual SQL, not a mock.

const connectionString =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:5432/say_it_with_a_playlist";

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

describe("UserResource.upsertBySpotifyId", () => {
  it("inserts a new user and returns a generated id", async () => {
    const user = await users.upsertBySpotifyId({
      spotifyUserId: "spotify-1",
      displayName: "Ada",
      email: "ada@example.com",
    });
    expect(user.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(user.spotifyUserId).toBe("spotify-1");
    expect(user.displayName).toBe("Ada");
    expect(user.email).toBe("ada@example.com");
  });

  it("is idempotent on spotify_user_id: updates in place, keeps the same id", async () => {
    const first = await users.upsertBySpotifyId({
      spotifyUserId: "spotify-2",
      displayName: "Old Name",
      email: "old@example.com",
    });
    const second = await users.upsertBySpotifyId({
      spotifyUserId: "spotify-2",
      displayName: "New Name",
      email: "new@example.com",
    });
    expect(second.id).toBe(first.id);
    expect(second.displayName).toBe("New Name");
    expect(second.email).toBe("new@example.com");
  });
});

describe("TokenResource", () => {
  async function makeUser() {
    return users.upsertBySpotifyId({
      spotifyUserId: "spotify-token-owner",
      displayName: null,
      email: null,
    });
  }

  it("returns null when no tokens are stored for the user", async () => {
    const user = await makeUser();
    expect(await tokens.get(user.id)).toBeNull();
  });

  it("round-trips a token set through save and get", async () => {
    const user = await makeUser();
    const expiresAt = new Date("2030-01-01T00:00:00.000Z");
    await tokens.save(user.id, {
      accessToken: "access-1",
      refreshToken: "refresh-1",
      scope: "user-read-email",
      tokenType: "Bearer",
      expiresAt,
    });

    const stored = await tokens.get(user.id);
    expect(stored).toEqual({
      accessToken: "access-1",
      refreshToken: "refresh-1",
      scope: "user-read-email",
      tokenType: "Bearer",
      expiresAt,
    });
  });

  it("overwrites the existing row on a second save (one row per user)", async () => {
    const user = await makeUser();
    await tokens.save(user.id, {
      accessToken: "access-1",
      refreshToken: "refresh-1",
      scope: "user-read-email",
      tokenType: "Bearer",
      expiresAt: new Date("2030-01-01T00:00:00.000Z"),
    });
    await tokens.save(user.id, {
      accessToken: "access-2",
      refreshToken: "refresh-2",
      scope: "user-read-email playlist-modify-private",
      tokenType: "Bearer",
      expiresAt: new Date("2031-01-01T00:00:00.000Z"),
    });

    const stored = await tokens.get(user.id);
    expect(stored?.accessToken).toBe("access-2");
    expect(stored?.refreshToken).toBe("refresh-2");

    const { rows } = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM spotify_tokens WHERE user_id = $1",
      [user.id],
    );
    expect(rows[0].count).toBe("1");
  });
});
