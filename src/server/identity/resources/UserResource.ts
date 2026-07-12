import type { Pool } from "pg";

import { getPool } from "@/server/shared/db";

// UserResource — storage access for the app-side user record. Lowest layer:
// it talks only to Postgres (via shared/db) and knows nothing about Spotify
// HTTP or session cookies.

export interface AppUser {
  id: string;
  spotifyUserId: string;
  displayName: string | null;
  email: string | null;
}

export interface UpsertUserInput {
  spotifyUserId: string;
  displayName: string | null;
  email: string | null;
}

export interface UserResource {
  upsertBySpotifyId(input: UpsertUserInput): Promise<AppUser>;
  /** The app-side user record, or null if the id matches no row. */
  findById(id: string): Promise<AppUser | null>;
}

interface UserRow {
  id: string;
  spotify_user_id: string;
  display_name: string | null;
  email: string | null;
}

function toAppUser(row: UserRow): AppUser {
  return {
    id: row.id,
    spotifyUserId: row.spotify_user_id,
    displayName: row.display_name,
    email: row.email,
  };
}

export function createUserResource(pool: Pool = getPool()): UserResource {
  return {
    async findById(id) {
      const { rows } = await pool.query<UserRow>(
        `SELECT id, spotify_user_id, display_name, email
           FROM users
          WHERE id = $1`,
        [id],
      );
      return rows[0] ? toAppUser(rows[0]) : null;
    },

    async upsertBySpotifyId(input) {
      const { rows } = await pool.query<UserRow>(
        `INSERT INTO users (spotify_user_id, display_name, email)
         VALUES ($1, $2, $3)
         ON CONFLICT (spotify_user_id) DO UPDATE
           SET display_name = EXCLUDED.display_name,
               email        = EXCLUDED.email,
               updated_at   = now()
         RETURNING id, spotify_user_id, display_name, email`,
        [input.spotifyUserId, input.displayName, input.email],
      );
      return toAppUser(rows[0]);
    },
  };
}
