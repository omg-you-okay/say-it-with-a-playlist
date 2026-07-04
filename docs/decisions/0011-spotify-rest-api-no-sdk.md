# 0011 — Spotify Web API via hand-rolled fetch, not the official SDK

Date: 2026-07-03 · Status: accepted (checked against developer.spotify.com and npm on this date)

## Context

Before Iteration 2/3 writes any Spotify-calling Playlist code, the owner asked how this
codebase relates to the official [`@spotify/web-api-ts-sdk`](https://github.com/spotify/spotify-web-api-ts-sdk)
and whether we follow Spotify's official way of doing things.

Findings:

- **The "official way" is the OAuth flow + the documented REST API — not the SDK.** The
  REST endpoints are Spotify's product interface; the SDK is one optional client of them.
  Calling `GET /v1/search` with `fetch` is exactly as official as calling the SDK's
  `search()` — same documented endpoint.
- **Our OAuth already matches Spotify's documented recommendation line for line.** For "a
  long-running application (e.g. web app running on the server)" that can safely store the
  client secret, Spotify prescribes the Authorization Code flow: `accounts.spotify.com/authorize`
  → `/api/token`, `state` for CSRF, Basic-auth token exchange, server-side secret, refresh
  via Basic auth, and "when a refresh token is not returned, continue using the existing
  token" — all of which `AuthEngine` implements (ADR 0008). PKCE is their prescription for
  apps that _cannot_ keep a secret (browser/mobile); that is not us.
- **The SDK's own server-side pattern assumes our design.** For user-delegated actions it
  documents: run the Authorization Code flow on your backend yourself, then hand the token
  to `SpotifyApi.withAccessToken()`. Full SDK adoption would therefore keep the entire
  Identity subsystem unchanged; only `SpotifyResource`'s three calls (search track, create
  playlist, add tracks) would go through it.
- **The SDK is dormant.** Latest release v1.2.0 (January 2024, ~2.5 years ago), dozens of
  open issues; Spotify's API changed since (late-2024 endpoint deprecations) without SDK
  follow-up. A dormant wrapper can _lag_ the official API.
- **Its auto-refresh conflicts with our architecture.** The SDK refreshes tokens internally
  (PKCE-style, no client secret), bypassing `UserManager`/`TokenResource` persistence. We
  would have to feed it doctored token objects so it never refreshes — otherwise a rotated
  refresh token is persisted nowhere and later refreshes fail with `invalid_grant` (the
  exact failure mode the ADR 0009 token flow exists to prevent).

## Decision

`SpotifyResource` (built in Iterations 2–3) calls the **documented REST endpoints directly
with typed, hand-rolled `fetch`**, following the established `AuthEngine` pattern: injected
`fetchFn` + clock for hermetic unit tests, `AbortSignal.timeout` on every call, typed
slices of the responses we actually use. The access token is passed in by `PlaylistManager`
(obtained via `UserManagerResource` → `UserManager.getFreshAccessToken`, ADR 0009); the
Resource performs no token acquisition or refresh of its own.

Because `SpotifyResource` is the single encapsulation boundary for Spotify HTTP, this
decision is deliberately cheap to reverse: adopting the SDK later would be a refactor
internal to that one file.

## Alternatives considered

- **Adopt `@spotify/web-api-ts-sdk` inside `SpotifyResource`.** Rejected: dormant since
  January 2024 while the API moved on; its internal auto-refresh must be actively
  suppressed to keep `UserManager` the only refresher; a large dependency for three
  endpoints (YAGNI).
- **Use the SDK for its response types only.** Rejected: a dependency for types we can
  write in ~30 lines, and the types would drift with the same dormancy problem.
- **Rewrite Identity's OAuth around the SDK.** Not applicable: the SDK's own server-side
  guidance is to run the Authorization Code flow yourself — there is nothing to rewrite to.

## Consequences

- We stay 100% on Spotify's documented interface with no intermediary to lag or abandon;
  the cost is writing/maintaining ~3 typed endpoint wrappers ourselves, mitigated by the
  already-proven injected-`fetchFn` test pattern.
- One operational fact learned from the docs, recorded here so it is not lost: **refresh
  tokens expire ~6 months after authorization** and cannot be extended by refreshing.
  `UserManager.getFreshAccessToken` will eventually see `invalid_grant` meaning "user must
  re-login"; a graceful re-auth path (surface a login-again state instead of a 500) is a
  known follow-up for Iteration 3+.
- If the SDK becomes actively maintained again and our endpoint surface grows, revisiting
  this ADR is a `SpotifyResource`-internal change — no Manager, Engine, or Identity code
  moves.
