# Roadmap — Say It With a Playlist

> Version-controlled iteration plan. The high-level phases mirror `CLAUDE.md` §9;
> this file adds the per-iteration breakdown, ordering, and "done when" criteria.
> Locked decisions live in `docs/decisions/` (ADRs) — this file references them, it
> does not relitigate them. One iteration ≈ one phase ≈ one (or a few) small PRs into
> `main` (GitHub Flow, ADR 0007).

**Stack (ADR 0001):** Next.js full-stack (App Router) · Supabase = managed Postgres in
prod only · shadcn/ui · TypeScript · Vitest. Data access via the `pg` driver, added the
iteration it is first needed (ADR 0005). Local DB = single `postgres:17-alpine` container.

**iDesign layering (CLAUDE.md §4):** Managers → (Engines, Resources). Engines never call
Engines. No layer skipping. Crossing a subsystem boundary goes through a **manager-resource**
— a Resource in the caller's subsystem that calls the other subsystem's Manager (ADR 0009).

| Subsystem | Managers                                       | Engines                           | Resources                             |
| --------- | ---------------------------------------------- | --------------------------------- | ------------------------------------- |
| Identity  | `UserManager`                                  | `AuthEngine`, `UserEngine`        | `UserResource`, `TokenResource`       |
| Playlist  | `PlaylistManager` (owns the backtracking loop) | `SentenceEngine`, `SpotifyEngine` | `SpotifyResource`, `PlaylistResource` |

---

## Iteration 0 — Foundations ✅ DONE (PR #5, merged to `main` as `176ce24`)

Repo + GitHub Flow branching (ADR 0007) · incremental CI `build-and-test` single Node job
(ADR 0004) · branch protection on `main` · Next.js + shadcn/ui scaffold · ESLint + Prettier

- shared `.vscode/` (ADR 0006) · Vitest · docker-compose Postgres with `pnpm db:up/down/reset/logs`
  (ADR 0005) · iDesign skeleton under `src/server/{identity,playlist}/{managers,engines,resources}`
  · `src/server/shared/env.ts` (+ test) · all five CLAUDE.md §8 open decisions resolved in ADRs 0002/0003.

---

## Iteration 1 — OAuth / Identity subsystem ✅ DONE (PR #7; post-merge fix PR #8)

Full Spotify OAuth 2.0 Authorization Code round-trip; backend holds all tokens (locked).
Session = httpOnly signed JWT cookie via `jose` (ADR 0002); OAuth HTTP lives in `AuthEngine`
with injected `fetch`/clock (ADR 0008). Shipped: `AuthEngine` (authorize URL / code exchange /
refresh / profile; `playlist-modify-*` scopes requested up front), `UserResource` +
`TokenResource` (`pg` pool in `shared/db.ts`, first migration `db/init/001_identity.sql`),
`UserManager` (`beginLogin` / `handleCallback` / `getFreshAccessToken`), login/callback/logout
routes. 35 tests: engine/session/manager units + real-Postgres integration (CI grew a
`postgres:17-alpine` service + `pnpm db:migrate`). Verified with a live login locally.

- **PR #8 (post-merge fix):** callback redirect pinned to the request `Host` header — `next dev`
  resolves `request.url` to `localhost` even under `-H 127.0.0.1`, stranding the session cookie
  on the wrong origin (loopback cookie notes: ADR 0008; full forensics: PR #8). Also set
  `fileParallelism: false` in Vitest — the two integration files `TRUNCATE` the same DB and
  raced in parallel workers.
- **Deferred:** hosted Supabase + deploy target (and Playwright MCP); `UserEngine` (no pure user
  logic yet — YAGNI); secrets strategy (local `.env` / CI secrets / prod env) — decision still owed.
- **PR #7 review follow-ups** (clear the state cookie on callback failure paths; one shared
  cookie-clear idiom; explicit `SpotifyTokenSet → StoredTokens` mapper): ✅ closed by the
  `chore/review-cleanups` PR.
- **Done when:** login works, session cookie set, tokens stored, refresh works server-side. ✅

---

## Iteration 1.5 — Cross-subsystem foundation fix ✅ DONE

Docs + ADRs + eslint only — no production code rewrite. The planned token path (Playlist
reading Identity's token store) couldn't refresh an expired token, so cross-subsystem access
became the **manager-resource** pattern: `PlaylistManager → UserManagerResource →
UserManager.getFreshAccessToken`, `TokenResource` now Identity-private (ADR 0009). Also locked
"iDesign at the architecture level, idiomatic TypeScript in the code" (ADR 0010). Lint gained
the `manager-resource` element + call rules (retired `token-store`); docs synced
(CLAUDE.md §4/§6, `src/server/README.md`, this file). Done when: lint + 38 tests green. ✅

---

## Iteration 2 — Sentence decomposition (Playlist, pure logic) ✅ DONE (branch `feature/sentence-decomposition`)

The heart of the system (CLAUDE.md §3), shipped as the pure decomposition core with the
search mocked in tests. Spotify HTTP = typed, hand-rolled `fetch` (ADR 0011). Shipped:
shared `normalize` / `normalizeTitle` (ADR 0003 pipeline; version-tail stripping is
**title-side only** — applied to a sentence it ate real words ("call me (maybe)") — and
tails strip to a fixed point so "Song (Live) - Remix" → "song"); `SentenceEngine`
(tokenise; groupings **longest-first, span cap 5**; substitution variants ordered
**fewest-substitutions-first** — the brief's "defined priority order", decided here, not
ADR-locked; config-driven map per ADR 0003); `SpotifyEngine` (exact-after-normalization,
title side stripped, phrase side not); `SpotifyResource.searchTracks` (injected `fetchFn`,
timeout, typed slice; token as call argument per ADR 0009); `PlaylistManager.matchSentence`
— the backtracking loop with a per-request search memo **and a dead-end memo** (a failed
suffix is abandoned permanently; without it the search is exponential in sentence length).
75 new unit tests → suite 113.

- **No new ADR needed:** the priority order is engine-internal and cheap to change —
  documented in `SentenceEngine` and here, deliberately not locked.
- **Known limitation:** nested-paren version tails ("Song (Remix (2003 Remaster))") aren't
  stripped — that one track can't match; the loop degrades gracefully to other candidates.
- **Follow-ups → Iteration 3 (must land before the loop hits the live API):** per-request
  search budget + 429/Retry-After handling in `SpotifyResource`; consider extracting a
  shared fetch-error/timeout helper (SpotifyResource is the 3rd copy of the AuthEngine
  idiom); re-add real `PlaylistManager` wiring (removed as dead code this iteration) with
  the generate endpoint + `UserManagerResource`. Still owed from the Iteration 2 spec: the
  concurrent-refresh race fix (per-user lock / `SELECT … FOR UPDATE`) lands inside
  `UserManager.getFreshAccessToken` together with the adapter.
- **Done when:** given a sentence, the loop returns an ordered set of matched tracks covering the whole sentence, or a list of unmatched phrases. ✅ (mocked search)

---

## Iteration 3 — Playlist creation ← NEXT

- `SpotifyResource` / `SpotifyEngine` — create playlist on the user's account; add tracks in sentence order (REST via typed `fetch`, injected `fetchFn` — ADR 0011).
- Playlist naming: the sentence itself, truncated to 100 chars; branding in the description (ADR 0003).
- `PlaylistResource` — persist playlist history (sentence, tracks, link, timestamp) per user.
- End-to-end `POST` generate endpoint: sentence in → decomposition → playlist created → link + tracks out.
- **Tests:** integration test for the generate endpoint.
- **Done when:** one API call turns a sentence into a real Spotify playlist on the user's account and records history.

---

## Iteration 4 — Frontend

- "Log in with Spotify" button; OAuth callback handling in the UI.
- Sentence input; submit → call generate endpoint.
- Result display (tracks + shareable playlist link); loading and error states (incl. the no-match unmatched-phrases response).
- shadcn/ui components (MCP already in `.mcp.json`).
- **Done when:** a user completes the whole flow in the browser without touching the API directly.

---

## Iteration 5 — Persistence & history

- Past-playlists view reading `PlaylistResource` history.
- Add Playwright MCP / e2e coverage by this point.
- **Done when:** a logged-in user can revisit previously generated playlists.

---

## Iteration 6 — Advanced (explicitly out of MVP scope)

Manual song replacement after generation · genre filtering. Tracked for visibility only;
not built during MVP (CLAUDE.md §10 non-goals).
