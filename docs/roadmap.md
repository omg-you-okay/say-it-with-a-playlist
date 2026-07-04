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

## Iteration 1 — OAuth / Identity subsystem ✅ DONE (PR #7)

Full Spotify OAuth 2.0 Authorization Code round-trip. Backend holds all tokens; they never
reach the frontend (locked). Session = httpOnly signed JWT cookie (ADR 0002). OAuth HTTP
placed in `AuthEngine` rather than a Resource (ADR 0008).

**Prerequisite (owner):** Spotify dev app with loopback redirect
`http://127.0.0.1:3000/api/auth/callback`. ✅ done by owner; verified locally (login redirect

- state cookie, callback persists user + tokens, session cookie set).

* ✅ `AuthEngine` — authorize URL (scopes + state); code→token exchange; refresh; profile fetch. `fetch`/clock injected → unit-testable. Scopes include `playlist-modify-*` up front to avoid re-consent in Iter 3.
* ✅ `UserResource` (`upsertBySpotifyId`) / `TokenResource` (`save`/`get`, Identity-private token store). `pg` driver + pool in `shared/db.ts`; first migration `db/init/001_identity.sql`.
* ✅ `UserManager` — `beginLogin` / `handleCallback` (validates state → exchange → upsert → store → mint session) / `getFreshAccessToken` (server-side refresh on expiry).
* ✅ Route handlers: `GET /api/auth/login`, `GET /api/auth/callback`, `POST /api/auth/logout`. Refresh is a `UserManager` method (no endpoint yet — no caller until Playlist; YAGNI).
* ✅ Session cookie via `jose` (`shared/session.ts`): httpOnly, SameSite=Lax, payload = app user id. Cookie config in `shared/cookies.ts`. Dev server bound to `127.0.0.1` (`next dev -H 127.0.0.1`) so the browse origin matches the OAuth origin.
* ✅ **Tests (35 passing):** AuthEngine units (fake fetch); session units; UserManager orchestration (mocked deps); Resource + auth-route integration tests against real Postgres (CI grew a `postgres:17-alpine` service + `pnpm db:migrate`).
* **Deferred (NOT done this iteration):**
  - **Infra:** hosted Supabase project + Supabase MCP — not provisioned (app runs on local Postgres; no deploy target yet). Optional Playwright MCP also not added.
  - **`UserEngine`** — no pure user logic needed yet (YAGNI).
  - **Secrets strategy** (local `.env` / CI GitHub Secrets / prod host env) — discussed, decision deferred to a follow-up PR; no ADR yet.
* **Post-merge fix (PR #8):** live login worked but the OAuth callback's success/error redirect landed the browser on `localhost` instead of `127.0.0.1`, stranding the just-set session cookie on the wrong origin (→ logged out). Root cause: `next dev` resolves `request.url`'s host to `localhost` even with `-H 127.0.0.1`, so `new URL("/", request.url)` was wrong. Fixed `redirectHome` to derive host from the `Host` header (`x-forwarded-host`/`-proto` aware) instead of `request.url`; added a regression test. Binding to `127.0.0.1` (line above) is necessary but was not sufficient on its own.
  - Also surfaced + fixed a latent CI flake: the two integration test files both `TRUNCATE users CASCADE` against the **same** Postgres DB, and Vitest ran files in parallel workers → one file's teardown could wipe another's rows mid-test. Set `fileParallelism: false` in `vitest.config.ts` (suite is tiny; cost negligible). Future per-worker DB isolation is the scale-up answer if integration tests grow.
* **Code-review follow-ups (PR #7, minor — not blocking):**
  - Clear the OAuth state cookie on the callback **failure/mismatch** paths too (today only the success path deletes it).
  - Add an explicit `SpotifyTokenSet → StoredTokens` mapper so the two near-identical token shapes can't drift (ADR 0008 keeps them as separate types on purpose).
  - Unify the cookie-clear idiom: `logout` hand-rolls `maxAge:0` while `callback` uses `cookies.delete()`.
* **Done when:** a user can log in with Spotify, a session cookie is set, tokens are stored, and refresh works server-side. ✅ met (refresh covered by unit tests; live login verified locally).

---

## Iteration 1.5 — Cross-subsystem foundation fix ✅ DONE

Surfaced while kicking off Iteration 2: the planned cross-subsystem token path (Playlist
reading Identity's token store / `SpotifyResource` calling `UserManager`) couldn't refresh
an expired token and violated the lint boundaries. Adopted the iDesign **manager-resource**
pattern instead — docs + ADRs + eslint only, **no production code rewrite**.

- ✅ ADR 0009 — cross-subsystem access via a manager-resource (`<TargetManager>Resource`,
  in the caller's subsystem, calling the callee's Manager). Supersedes the shared-token-store
  rule. Token flow becomes `PlaylistManager → UserManagerResource → UserManager.getFreshAccessToken`
  (adapter built in Iteration 3). `TokenResource` is now Identity-private.
- ✅ ADR 0010 — iDesign applied at the architecture level; code stays idiomatic TypeScript
  (factory functions, not mimicked-C# classes). No rewrite of existing components.
- ✅ `eslint.config.mjs` — added the `manager-resource` element + call rules; retired the
  `token-store` element (`TokenResource` reclassified as a plain Identity resource).
- ✅ Doc sync: CLAUDE.md §4/§6, `src/server/README.md`, this roadmap.
- **Done when:** lint passes under the new rules and the existing tests stay green (38). ✅

---

## Iteration 2 — Sentence decomposition (Playlist, pure logic) ← NEXT

The heart of the system (CLAUDE.md §3). Candidate generation is pure and independently
unit-testable; match validation talks to the music API; the backtracking loop lives in
`PlaylistManager`, not in either concern. Spotify HTTP = typed, hand-rolled `fetch` against
the documented REST API — the official SDK was evaluated and rejected (ADR 0011).

- Shared normalization utility: lowercase, strip punctuation/diacritics, strip version suffixes (parens/bracket/dash tails) — used by both engines (ADR 0003).
- `SentenceEngine` — tokenise; generate multi-word candidate groupings in priority order; apply substitution map (to→2, you→U, for→4, are→R; one→1…ten→10; and→&; be→B/see→C/why→Y/oh→O/ex→X) (ADR 0003). **Pure, no external deps.**
- `SpotifyEngine` — match-quality judgement: exact equality after normalization (ADR 0003).
- `SpotifyResource` — Spotify search API access. It needs a fresh access token, which it
  gets (Iteration 3) via the `UserManagerResource` adapter → `UserManager.getFreshAccessToken`,
  **not** by reading the token store and **not** by calling `UserManager` directly (ADR 0009;
  lint forbids Resource→Manager). The concurrent-refresh race flagged in PR #7 (two parallel
  refreshes persisting a rotated-out refresh token → later `invalid_grant`) is fixed inside
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
