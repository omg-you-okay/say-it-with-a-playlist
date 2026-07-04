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

## Iteration 2 — Sentence decomposition (Playlist, pure logic) ← NEXT

The heart of the system (CLAUDE.md §3). Candidate generation is pure and independently
unit-testable; match validation talks to the music API; the backtracking loop lives in
`PlaylistManager`, not in either concern. Spotify HTTP = typed, hand-rolled `fetch` against
the documented REST API — the official SDK was evaluated and rejected (ADR 0011).

- Shared normalization utility: lowercase, strip punctuation/diacritics, strip version suffixes (parens/bracket/dash tails) — used by both engines (ADR 0003).
- `SentenceEngine` — tokenise; generate multi-word candidate groupings in priority order; apply substitution map (to→2, you→U, for→4, are→R; one→1…ten→10; and→&; be→B/see→C/why→Y/oh→O/ex→X) (ADR 0003). **Pure, no external deps.**
- `SpotifyEngine` — match-quality judgement: exact equality after normalization (ADR 0003).
- `SpotifyResource` — Spotify search API access. It receives the access token as a call
  argument: `PlaylistManager` obtains a fresh token via the `UserManagerResource` adapter
  (→ `UserManager.getFreshAccessToken`, built in Iteration 3) and passes it in — a plain
  Resource may not call the adapter itself (lint: resources import only `shared/`; ADR 0009).
  The concurrent-refresh race flagged in PR #7 (two parallel refreshes persisting a
  rotated-out refresh token → later `invalid_grant`) is fixed inside
  `UserManager.getFreshAccessToken` with a per-user lock / `SELECT … FOR UPDATE`, landing with
  the adapter in Iteration 3. **For Iteration 2 the search is mocked** (pure decomposition core).
- `PlaylistManager` — the backtracking orchestration loop: try candidate → validate → on failure backtrack and re-derive groupings for the remainder; give up = no playlist (ADR 0003 no-match behavior).
- **Tests:** heavy unit coverage of SentenceEngine + normalization + backtracking; mocked search.
- **Done when:** given a sentence, the loop returns an ordered set of matched tracks covering the whole sentence, or a list of unmatched phrases.

---

## Iteration 3 — Playlist creation

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
