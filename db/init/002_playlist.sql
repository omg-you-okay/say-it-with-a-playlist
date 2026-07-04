-- Playlist subsystem schema (Iteration 3 — playlist creation).
--
-- playlists — history of generated playlists per user (brief §6): the
-- sentence, the matched tracks (in sentence order), the created Spotify
-- playlist's id/link, and when it happened. Playlist-owned; unlike tokens,
-- there is no Identity equivalent to route through (ADR 0009 only applies to
-- the token case).

CREATE TABLE IF NOT EXISTS playlists (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  sentence             TEXT NOT NULL,
  spotify_playlist_id  TEXT NOT NULL,
  url                  TEXT NOT NULL,
  tracks               JSONB NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Iteration 5's past-playlists view lists a user's history newest-first.
CREATE INDEX IF NOT EXISTS playlists_user_id_created_at_idx
  ON playlists (user_id, created_at DESC);
