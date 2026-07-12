# 0012 — Split generate into preview + create; visibility becomes a user choice

Date: 2026-07-04 · Status: accepted · Supersedes the single-shot `generatePlaylist`
use case from Iteration 3 ([roadmap](../roadmap.md) Iteration 3) and its hard-coded
`public: false` (flagged as a deferred question in that iteration's review)

> **Amended by [ADR 0013](0013-streaming-preview-progress.md) (2026-07-12):** preview is no
> longer a single JSON response — it streams NDJSON progress events, and its `422` (no full
> cover) became a terminal event rather than a status code. The preview/create **split**, the
> **"create trusts the client-confirmed tracks"** rule, and the **create** route below are all
> unchanged; the terminal stream event carries the same track list the client echoes to create.

## Context

Iteration 3 shipped one endpoint, `POST /api/playlists/generate`, that matched the
sentence and created the playlist in the same request — no chance for the user to see
the result before it landed on their account, and no visibility choice (`public: false`
was hard-coded). The project owner asked (roadmap, 2026-07-04) for a preview-then-create
UX: show the matched tracks first, then a "Create playlist" button with a public/private
toggle at that point.

## Decision

Split the one-shot use case into two `PlaylistManager` methods, and thread a visibility
flag through to Spotify:

- **`previewSentence(userId, sentence)`** — fresh token via `UserManagerResource`
  (ADR 0009) → `matchSentence` → return tracks or unmatched phrases. Creates nothing,
  saves nothing. Backing route: `POST /api/playlists/preview`.
- **`createFromTracks(userId, sentence, tracks, isPublic)`** — fresh token → build
  metadata → create the playlist with `public: isPublic` → add the given tracks in
  order → save history. Backing route: `POST /api/playlists/create`.
- **Create trusts the client-confirmed tracks rather than re-matching.** The tracks a
  user approved in the preview response are echoed back verbatim in the create request
  body (route-level shape validation only — no re-search). This guarantees what gets
  created is exactly what was previewed, and avoids a second, redundant Spotify search.
  Trusting client-supplied track data is an acceptable risk here: it can only build a
  playlist on the caller's own account, the same risk class already accepted for the
  single-user MVP (see Iteration 3's noted orphaned-playlist-on-partial-failure tradeoff).
- **Visibility is a user choice, not a hard-coded default.** `SpotifyResource.createPlaylist`
  gains an `isPublic` parameter (default `false`, so every pre-existing caller/test keeps
  working); the frontend surfaces it as a toggle at the create step, defaulting to private.

`generatePlaylist` and the `/generate` route are removed — no remaining caller (YAGNI).

## Alternatives considered

- **Re-run the match in the create step** (search again instead of trusting the client's
  track list). Rejected: doubles Spotify calls for no benefit, and a match could change
  between preview and create (e.g. a mid-flight catalog change), silently creating a
  playlist that doesn't match what the user approved.
- **Keep one endpoint, add a `dryRun` flag.** Rejected: conflates two different response
  shapes and status-code contracts (preview never 201s a playlist; create never returns
  a bare match list) into one handler for no real simplification.

## Consequences

- Two small, single-purpose endpoints instead of one endpoint with two lifecycles.
- The frontend flow (Iteration 4) is a straightforward two-step form: preview, then
  confirm+create.
- `MatchedTrack` (phrase + `TrackCandidate`) is now part of the wire contract between
  preview's response and create's request body, not just an internal manager type.
