# 0008 — Spotify OAuth HTTP lives in AuthEngine, not a Resource

Date: 2026-06-13 · Status: accepted

## Context

The iDesign rules (CLAUDE.md §4, brief) say **Resources** encapsulate access to
storage and external APIs, while **Engines** hold volatile business logic. The
Iteration-2 search integration follows this literally: `SpotifyResource` owns
the Spotify search HTTP.

OAuth, however, is awkward under that split. The token exchange and refresh are
HTTP calls to `accounts.spotify.com`, but they are also the _core OAuth logic_
(building the request, applying Basic auth, parsing/normalizing the token
response, computing expiry). The roadmap's Iteration-1 row deliberately assigned
all of this — "build the authorize URL; exchange auth code → tokens; refresh
logic" — to `AuthEngine`, and listed no auth-specific Resource. A strict reading
of "Resources own external APIs" would instead introduce a `SpotifyAuthResource`
for the transport.

## Decision

`AuthEngine` performs the Spotify OAuth HTTP directly: `exchangeCode`,
`refreshAccessToken`, and `fetchProfile` (the `/v1/me` call used to key the user
record). No separate auth Resource is introduced.

To keep the engine **unit-testable without a network** — auth testing is
non-negotiable (brief §7) — the HTTP transport (`fetchFn`) and the clock (`now`)
are **injected** via the engine's config, defaulting to global `fetch` /
`Date.now`. Tests pass a fake `fetch`; no Spotify call is ever made in CI.

Two related implementation choices recorded here:

- **Loopback-only origin.** Spotify rejects `http://localhost` redirect URIs, so
  the redirect URI is `http://127.0.0.1:3000/...`. Because browsers treat
  `localhost` and `127.0.0.1` as **separate cookie origins**, the whole app must
  be browsed on `127.0.0.1` or the session cookie (set on the `127.0.0.1` jar)
  won't be sent. `next dev` is therefore bound with `-H 127.0.0.1`.
- **Scopes requested up front.** The authorize URL requests
  `playlist-modify-public`/`playlist-modify-private` alongside the profile read
  scopes now, so the user does not have to re-consent when playlist creation
  lands (Iteration 3).

## Alternatives considered

- **`SpotifyAuthResource` for the token/profile HTTP, AuthEngine builds/parses
  requests only.** Strictest iDesign reading. Rejected: it splits one cohesive
  OAuth operation across two layers, adds an unlisted component the roadmap
  didn't call for, and buys little — the transport is already isolated behind the
  injected `fetchFn`, so testability (the usual reason to push IO into a
  Resource) is already satisfied.
- **AuthEngine calls global `fetch` directly (no injection).** Simpler, but makes
  the engine require a network or `vi.stubGlobal` for every test. Rejected;
  injection is cheap and keeps the unit tests hermetic.

## Consequences

- The "Resources own external APIs" guideline has one sanctioned exception: the
  **OAuth** token/profile HTTP lives in `AuthEngine`. The Playlist subsystem's
  search/create HTTP still belongs in `SpotifyResource` (Iter 2–3) — this ADR
  does not generalize.
- `AuthEngine` depends on an injectable `fetchFn`; callers in `UserManager` use
  the default (real `fetch`), tests inject a fake.
- The lint boundary rules are unaffected: `AuthEngine` imports no other element
  type, so calling global `fetch` is invisible to `eslint-plugin-boundaries`.
