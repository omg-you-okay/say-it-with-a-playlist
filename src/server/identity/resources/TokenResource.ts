import type { Pool } from "pg";

import { getPool } from "@/server/shared/db";

// TokenResource — the Identity-private token store (brief §4/§6). Identity reads
// and writes it; it is NOT read across the subsystem boundary. Playlist obtains a
// fresh access token through the `UserManagerResource` adapter → `UserManager`
// instead (ADR 0009), since a raw read can't refresh an expired token. Its row
// types are defined locally so it depends on neither Engine.
// Exactly one row per user (user_id is the primary key).

export interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  scope: string | null;
  tokenType: string | null;
  expiresAt: Date;
}

/**
 * The token row, locked for the duration of a `withLockedTokens` callback,
 * plus a `save` bound to the same transaction.
 */
export interface LockedTokens {
  tokens: StoredTokens | null;
  save(tokens: StoredTokens): Promise<void>;
}

export interface TokenResource {
  save(userId: string, tokens: StoredTokens): Promise<void>;
  get(userId: string): Promise<StoredTokens | null>;
  /**
   * Run `fn` with this user's token row locked against concurrent writers.
   *
   * Refreshing is read-then-write, and Spotify may rotate the refresh token as
   * it goes — so two callers racing on an expired row can each refresh with the
   * same token and the loser can write a dead one over the winner's live one,
   * logging the user out for good (ADR 0017). Serializing has to happen in the
   * one thing every instance shares, which is Postgres: an in-process mutex
   * would only order the callers inside a single server.
   *
   * The caller is expected to re-check the (now locked) row before acting — by
   * the time the lock is granted, whoever it queued behind may already have
   * done the work.
   */
  withLockedTokens<T>(
    userId: string,
    fn: (locked: LockedTokens) => Promise<T>,
  ): Promise<T>;
}

interface TokenRow {
  access_token: string;
  refresh_token: string;
  scope: string | null;
  token_type: string | null;
  expires_at: Date;
}

// The queries run either on the pool (the ordinary path) or on one checked-out
// client (inside `withLockedTokens`' transaction). Both satisfy this, so the SQL
// is written once and the caller decides where it runs.
type Queryable = Pick<Pool, "query">;

const SELECT_SQL = `SELECT access_token, refresh_token, scope, token_type, expires_at
                      FROM spotify_tokens
                     WHERE user_id = $1`;

const UPSERT_SQL = `INSERT INTO spotify_tokens
                      (user_id, access_token, refresh_token, scope, token_type, expires_at)
                    VALUES ($1, $2, $3, $4, $5, $6)
                    ON CONFLICT (user_id) DO UPDATE
                      SET access_token  = EXCLUDED.access_token,
                          refresh_token = EXCLUDED.refresh_token,
                          scope         = EXCLUDED.scope,
                          token_type    = EXCLUDED.token_type,
                          expires_at    = EXCLUDED.expires_at,
                          updated_at    = now()`;

function toStoredTokens(row: TokenRow): StoredTokens {
  return {
    accessToken: row.access_token,
    refreshToken: row.refresh_token,
    scope: row.scope,
    tokenType: row.token_type,
    expiresAt: row.expires_at,
  };
}

async function upsert(
  db: Queryable,
  userId: string,
  tokens: StoredTokens,
): Promise<void> {
  await db.query(UPSERT_SQL, [
    userId,
    tokens.accessToken,
    tokens.refreshToken,
    tokens.scope,
    tokens.tokenType,
    tokens.expiresAt,
  ]);
}

export function createTokenResource(pool: Pool = getPool()): TokenResource {
  return {
    async save(userId, tokens) {
      await upsert(pool, userId, tokens);
    },

    async get(userId) {
      const { rows } = await pool.query<TokenRow>(SELECT_SQL, [userId]);
      const row = rows[0];
      return row ? toStoredTokens(row) : null;
    },

    async withLockedTokens(userId, fn) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        // FOR UPDATE holds the row against other writers until this transaction
        // ends. A caller racing us blocks here rather than reading the stale row
        // we are about to replace.
        const { rows } = await client.query<TokenRow>(
          `${SELECT_SQL} FOR UPDATE`,
          [userId],
        );
        const row = rows[0];
        const result = await fn({
          tokens: row ? toStoredTokens(row) : null,
          save: (tokens) => upsert(client, userId, tokens),
        });
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {
          // The transaction is already doomed and we are on our way out with the
          // original error — a failing rollback (dead connection, say) must not
          // mask it.
        });
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
