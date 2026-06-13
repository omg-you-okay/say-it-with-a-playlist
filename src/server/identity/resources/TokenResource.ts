import type { Pool } from "pg";

import { getPool } from "@/server/shared/db";

// TokenResource — the shared token store (brief §4/§6). The Identity subsystem
// writes it here; the Playlist subsystem will read it later. This is the one
// sanctioned cross-subsystem touchpoint, so its types are defined locally
// rather than borrowed from an Engine — it must not depend on either subsystem.
// Exactly one row per user (user_id is the primary key).

export interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  scope: string | null;
  tokenType: string | null;
  expiresAt: Date;
}

export interface TokenResource {
  save(userId: string, tokens: StoredTokens): Promise<void>;
  get(userId: string): Promise<StoredTokens | null>;
}

interface TokenRow {
  access_token: string;
  refresh_token: string;
  scope: string | null;
  token_type: string | null;
  expires_at: Date;
}

export function createTokenResource(pool: Pool = getPool()): TokenResource {
  return {
    async save(userId, tokens) {
      await pool.query(
        `INSERT INTO spotify_tokens
           (user_id, access_token, refresh_token, scope, token_type, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (user_id) DO UPDATE
           SET access_token  = EXCLUDED.access_token,
               refresh_token = EXCLUDED.refresh_token,
               scope         = EXCLUDED.scope,
               token_type    = EXCLUDED.token_type,
               expires_at    = EXCLUDED.expires_at,
               updated_at    = now()`,
        [
          userId,
          tokens.accessToken,
          tokens.refreshToken,
          tokens.scope,
          tokens.tokenType,
          tokens.expiresAt,
        ],
      );
    },

    async get(userId) {
      const { rows } = await pool.query<TokenRow>(
        `SELECT access_token, refresh_token, scope, token_type, expires_at
           FROM spotify_tokens
          WHERE user_id = $1`,
        [userId],
      );
      const row = rows[0];
      if (!row) return null;
      return {
        accessToken: row.access_token,
        refreshToken: row.refresh_token,
        scope: row.scope,
        tokenType: row.token_type,
        expiresAt: row.expires_at,
      };
    },
  };
}
