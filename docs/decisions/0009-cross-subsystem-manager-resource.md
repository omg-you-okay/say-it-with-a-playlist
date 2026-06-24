# 0009 — Cross-subsystem access via a manager-resource

Date: 2026-06-25 · Status: accepted · Supersedes the cross-subsystem mechanism described in
CLAUDE.md §4.3/§6 and `src/server/README.md` (the "shared token store read directly" rule)

## Context

The Playlist subsystem needs the user's Spotify **access token** to call the search/create
APIs. Two earlier answers were on the table and both fail:

1. **"Playlist reads the shared `TokenResource` directly"** (CLAUDE.md §4.3, §6). Reading a
   raw token row hands Playlist a possibly **expired** token. Refreshing it requires
   `AuthEngine` (the Spotify client secret + token endpoint) — Identity business logic that
   Playlist must not duplicate. So a plain read is not enough.
2. **"Sequence the refresh in the route handler"** (old `src/server/README.md`). Workable,
   but it pushes coordination into every caller and means a Manager can't satisfy its own
   dependencies — the route has to pre-fetch a token and pass it in.

Separately, the lint boundaries (`eslint.config.mjs`) correctly forbid a Resource→Manager
call and a cross-subsystem Manager→Manager call, so the roadmap's earlier idea of
`SpotifyResource` calling `UserManager.getFreshAccessToken` directly was never legal.

## Decision

Cross-subsystem access goes through a **manager-resource**: a Resource that lives in the
**caller's** subsystem and whose "external system" is the **Manager** (public front door)
of the **callee's** subsystem. It obeys the same rules as any Resource — it is the lowest
layer, business logic depends on it, and only it knows the other subsystem exists.

- **Naming:** name the adapter after the manager it reaches — `<TargetManager>Resource.ts`,
  on the caller's side. A manager-resource is identified by the `*ManagerResource*`
  filename and classified as its own element type in lint.
- **Allowed calls (lint):** a manager-resource may call a Manager in any subsystem (and
  `shared/`); same-subsystem Managers and Engines may call it like any Resource.
- **For the token case specifically:** Playlist gets a *fresh* token via
  `playlist/resources/UserManagerResource.ts` → `UserManager.getFreshAccessToken(userId)`.
  Flow: `PlaylistManager → UserManagerResource → UserManager`. `TokenResource` goes back to
  being **Identity-private** — it is no longer a shared cross-subsystem store.
- The `UserManagerResource` adapter itself is implemented in **Iteration 3** (no caller
  until the generate endpoint — YAGNI). This ADR locks the pattern, the naming, and the
  lint rule now, before any Playlist code is written against the old mechanism.

## Alternatives considered

- **Shared data resource (Playlist reads `TokenResource`).** Rejected: cannot refresh.
- **Route-handler orchestration.** Rejected: leaks coordination into callers and leaves the
  Manager unable to obtain its own dependencies; the adapter is more cohesive.
- **Direct `PlaylistManager → UserManager` call.** Rejected: cross-subsystem Manager→Manager
  coupling; the adapter is the iDesign-sanctioned indirection (anti-corruption layer) and
  keeps Playlist's business logic ignorant of Identity.

## Consequences

- One sanctioned cross-subsystem touchpoint remains, but it is now an adapter the caller
  owns, not a shared table both subsystems poke at. If Identity's contract changes, only
  the adapter changes.
- `TokenResource` is reclassified from the special `token-store` lint element to a plain
  Identity `resource`; `UserManager → TokenResource` stays legal as a same-subsystem call.
- The pattern generalizes to any future cross-subsystem need, not just tokens.
