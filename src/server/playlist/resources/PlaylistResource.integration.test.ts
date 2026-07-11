import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { createUserResource } from "@/server/identity/resources/UserResource";
import { assertDisposableTestDb } from "@/server/shared/db";

import {
  createPlaylistResource,
  type PersistedTrack,
} from "./PlaylistResource";

// Integration test against a real Postgres (local `pnpm db:up`, or the
// postgres service in CI) — exercises the actual SQL, not a mock.

const connectionString =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:5432/say_it_with_a_playlist";

// TRUNCATEs tables — refuse to run against anything but the local/CI
// throwaway database (same guard as identity-resources.integration.test.ts).
assertDisposableTestDb(connectionString);

const pool = new Pool({ connectionString });
const users = createUserResource(pool);
const playlists = createPlaylistResource(pool);

beforeAll(async () => {
  await pool.query("SELECT 1"); // fail fast if the DB is unreachable
});

afterEach(async () => {
  await pool.query("TRUNCATE users CASCADE");
});

afterAll(async () => {
  await pool.end();
});

async function makeUser(spotifyUserId: string) {
  return users.upsertBySpotifyId({
    spotifyUserId,
    displayName: null,
    email: null,
  });
}

const helloTrack: PersistedTrack = {
  phrase: "hello",
  trackId: "id-hello",
  trackUri: "spotify:track:id-hello",
  trackName: "Hello",
  artistNames: ["Artist"],
};

describe("PlaylistResource.listByUser", () => {
  it("returns an empty list for a user with no history", async () => {
    const user = await makeUser("spotify-empty");
    expect(await playlists.listByUser(user.id)).toEqual([]);
  });

  it("round-trips save → list, preserving the track shape", async () => {
    const user = await makeUser("spotify-owner");
    await playlists.save(user.id, {
      sentence: "Hello!",
      spotifyPlaylistId: "playlist-1",
      url: "https://open.spotify.com/playlist/1",
      tracks: [helloTrack],
    });

    const history = await playlists.listByUser(user.id);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      sentence: "Hello!",
      url: "https://open.spotify.com/playlist/1",
      tracks: [helloTrack],
    });
    expect(history[0].id).toMatch(/^[0-9a-f-]{36}$/);
    expect(history[0].createdAt).toBeInstanceOf(Date);
  });

  it("orders newest first", async () => {
    const user = await makeUser("spotify-order");
    await playlists.save(user.id, {
      sentence: "First",
      spotifyPlaylistId: "playlist-first",
      url: "https://open.spotify.com/playlist/first",
      tracks: [helloTrack],
    });
    await playlists.save(user.id, {
      sentence: "Second",
      spotifyPlaylistId: "playlist-second",
      url: "https://open.spotify.com/playlist/second",
      tracks: [helloTrack],
    });

    const history = await playlists.listByUser(user.id);
    expect(history.map((entry) => entry.sentence)).toEqual(["Second", "First"]);
  });

  it("scopes results to the requesting user", async () => {
    const owner = await makeUser("spotify-a");
    const other = await makeUser("spotify-b");
    await playlists.save(owner.id, {
      sentence: "Mine",
      spotifyPlaylistId: "playlist-mine",
      url: "https://open.spotify.com/playlist/mine",
      tracks: [helloTrack],
    });

    expect(await playlists.listByUser(other.id)).toEqual([]);
    const ownerHistory = await playlists.listByUser(owner.id);
    expect(ownerHistory.map((entry) => entry.sentence)).toEqual(["Mine"]);
  });
});
