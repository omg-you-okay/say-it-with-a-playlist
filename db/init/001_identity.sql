-- Identity subsystem schema (Iteration 1 — OAuth).
--
-- Two tables:
--   users          — app-side user record, one per Spotify account.
--   spotify_tokens — the shared token store: written by the Identity subsystem,
--                    read by the Playlist subsystem later (the one sanctioned
--                    cross-subsystem touchpoint). Exactly one row per user.
--
-- Spotify access/refresh tokens live here, server-side only — they never reach
-- the frontend (locked decision, brief §5 / ADR 0002).

CREATE EXTENSION IF NOT EXISTS pgcrypto; -- for gen_random_uuid()

CREATE TABLE IF NOT EXISTS users (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  spotify_user_id  TEXT NOT NULL UNIQUE,
  display_name     TEXT,
  email            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS spotify_tokens (
  user_id        UUID PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  access_token   TEXT NOT NULL,
  refresh_token  TEXT NOT NULL,
  scope          TEXT,
  token_type     TEXT,
  expires_at     TIMESTAMPTZ NOT NULL,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
