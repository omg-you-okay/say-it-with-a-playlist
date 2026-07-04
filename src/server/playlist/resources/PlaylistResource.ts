import type { Pool } from "pg";

import { getPool } from "@/server/shared/db";

// PlaylistResource — persistence for generated-playlist history (brief §6).
// Playlist-owned: unlike the token case, playlist history has no Identity
// equivalent to adapt to, so this is a plain same-subsystem Resource.
//
// Its stored-track shape is deliberately its own type, not an import of the
// Manager's `MatchedTrack` — a Resource depends on nothing above it (same
// separation TokenResource/AuthEngine already follow, ADR 0008). The Manager
// maps to this shape when calling `save`.

export interface PersistedTrack {
  phrase: string;
  trackId: string;
  trackUri: string;
  trackName: string;
  artistNames: string[];
}

export interface SavePlaylistInput {
  sentence: string;
  spotifyPlaylistId: string;
  url: string;
  tracks: PersistedTrack[];
}

export interface PlaylistResource {
  save(userId: string, input: SavePlaylistInput): Promise<void>;
}

export function createPlaylistResource(
  pool: Pool = getPool(),
): PlaylistResource {
  return {
    async save(userId, input) {
      await pool.query(
        `INSERT INTO playlists (user_id, sentence, spotify_playlist_id, url, tracks)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          userId,
          input.sentence,
          input.spotifyPlaylistId,
          input.url,
          JSON.stringify(input.tracks),
        ],
      );
    },
  };
}
