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
Engines. No layer skipping. Cross-subsystem sharing only via the shared token store.

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

## Iteration 1 — OAuth / Identity subsystem ✅ DONE (PR #TBD)

Full Spotify OAuth 2.0 Authorization Code round-trip. Backend holds all tokens; they never
reach the frontend (locked). Session = httpOnly signed JWT cookie (ADR 0002). OAuth HTTP
placed in `AuthEngine` rather than a Resource (ADR 0008).

**Prerequisite (owner):** Spotify dev app with loopback redirect
`http://127.0.0.1:3000/api/auth/callback`. ✅ done by owner; verified locally (login redirect
+ state cookie, callback persists user + tokens, session cookie set).

- ✅ `AuthEngine` — authorize URL (scopes + state); code→token exchange; refresh; profile fetch. `fetch`/clock injected → unit-testable. Scopes include `playlist-modify-*` up front to avoid re-consent in Iter 3.
- ✅ `UserResource` (`upsertBySpotifyId`) / `TokenResource` (`save`/`get`, the shared token store). `pg` driver + pool in `shared/db.ts`; first migration `db/init/001_identity.sql`.
- ✅ `UserManager` — `beginLogin` / `handleCallback` (validates state → exchange → upsert → store → mint session) / `getFreshAccessToken` (server-side refresh on expiry).
- ✅ Route handlers: `GET /api/auth/login`, `GET /api/auth/callback`, `POST /api/auth/logout`. Refresh is a `UserManager` method (no endpoint yet — no caller until Playlist; YAGNI).
- ✅ Session cookie via `jose` (`shared/session.ts`): httpOnly, SameSite=Lax, payload = app user id. Cookie config in `shared/cookies.ts`. Dev server bound to `127.0.0.1` (`next dev -H 127.0.0.1`) so the browse origin matches the OAuth origin.
- ✅ **Tests (35 passing):** AuthEngine units (fake fetch); session units; UserManager orchestration (mocked deps); Resource + auth-route integration tests against real Postgres (CI grew a `postgres:17-alpine` service + `pnpm db:migrate`).
- **Deferred (NOT done this iteration):**
  - **Infra:** hosted Supabase project + Supabase MCP — not provisioned (app runs on local Postgres; no deploy target yet). Optional Playwright MCP also not added.
  - **`UserEngine`** — no pure user logic needed yet (YAGNI).
  - **Secrets strategy** (local `.env` / CI GitHub Secrets / prod host env) — discussed, decision deferred to a follow-up PR; no ADR yet.
- **Done when:** a user can log in with Spotify, a session cookie is set, tokens are stored, and refresh works server-side. ✅ met (refresh covered by unit tests; live login verified locally).

---

## Iteration 2 — Sentence decomposition (Playlist, pure logic) ← NEXT

The heart of the system (CLAUDE.md §3). Candidate generation is pure and independently
unit-testable; match validation talks to the music API; the backtracking loop lives in
`PlaylistManager`, not in either concern.

- Shared normalization utility: lowercase, strip punctuation/diacritics, strip version suffixes (parens/bracket/dash tails) — used by both engines (ADR 0003).
- `SentenceEngine` — tokenise; generate multi-word candidate groupings in priority order; apply substitution map (to→2, you→U, for→4, are→R; one→1…ten→10; and→&; be→B/see→C/why→Y/oh→O/ex→X) (ADR 0003). **Pure, no external deps.**
- `SpotifyEngine` — match-quality judgement: exact equality after normalization (ADR 0003).
- `SpotifyResource` — Spotify search API access (reads access token from the shared token store).
- `PlaylistManager` — the backtracking orchestration loop: try candidate → validate → on failure backtrack and re-derive groupings for the remainder; give up = no playlist (ADR 0003 no-match behavior).
- **Tests:** heavy unit coverage of SentenceEngine + normalization + backtracking; mocked search.
- **Done when:** given a sentence, the loop returns an ordered set of matched tracks covering the whole sentence, or a list of unmatched phrases.

---

## Iteration 3 — Playlist creation

- `SpotifyResource` / `SpotifyEngine` — create playlist on the user's account; add tracks in sentence order.
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
