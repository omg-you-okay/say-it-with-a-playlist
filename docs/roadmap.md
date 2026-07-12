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

## Iteration 2 — Sentence decomposition (Playlist, pure logic) ✅ DONE (PR #13)

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

## Iteration 3 — Playlist creation ✅ DONE

Closed the loop from decomposition (Iteration 2, mocked search) to a live, end-to-end feature.
Shipped: `SpotifyEngine.buildPlaylistMetadata` (name = sentence ≤100 chars, fixed branding
description, ADR 0003); `SpotifyResource` gained `getCurrentUserId` (`GET /v1/me`),
`createPlaylist`, `addTracks`, plus a shared `spotifyFetch` with 429/Retry-After retry-once
handling (closes the Iteration 2 follow-up); `UserManagerResource` — the ADR 0009 cross-subsystem
adapter (`playlist/resources/` → `UserManager.getFreshAccessToken`); `PlaylistResource` +
`db/init/002_playlist.sql` (history: sentence, tracks JSONB, spotify playlist id, url, timestamp;
own storage-shape type rather than importing the Manager's `MatchedTrack`, mirroring the
`TokenResource`/`AuthEngine` separation, ADR 0008); `PlaylistManager.generatePlaylist` — token →
match → create playlist → add tracks in sentence order → save history, plus a per-request search
budget (`maxSearches`, default 100, injectable) so one request can't hammer Spotify unboundedly;
`createPlaylistManager()` factory; `POST /api/playlists/generate` (401 no session, 400 blank
sentence, 422 no-match with `unmatched` phrases and nothing created, 200 `{ url, tracks }`). 20 new
tests → suite 133 (engine/resource/manager-resource/manager units + a real-Postgres endpoint
integration test). Verified live against a real Spotify account: a full-cover sentence created a
real playlist and one history row; a no-cover sentence returned 422 with no playlist and no row.

- **Decision (not ADR-worthy — resource-internal, cheap to change per ADR 0011):** the Spotify
  user id needed for `POST /v1/users/{id}/playlists` is resolved via `GET /v1/me` on the fly
  rather than widening Identity's `UserManagerResource` contract — keeps Playlist ignorant of
  Identity's schema at the cost of one extra call per generate.
- **No new ADR needed:** every other choice this iteration (retry-once policy, search budget
  value, storage-shape separation) is Resource/Manager-internal and already covered by ADRs
  0008/0009/0011 — nothing architectural was relitigated or newly locked.
- **Deferred → follow-up PR:** the concurrent-refresh race fix (`SELECT … FOR UPDATE` /
  per-user lock in `UserManager.getFreshAccessToken`), owed since Iteration 2 — the single-user
  MVP doesn't hit concurrent generates yet, so it stayed out to keep this PR focused.
- **Deferred → ADR 0011 follow-up:** graceful re-auth when a refresh token has expired
  (`invalid_grant`) — currently surfaces as a generic 401/500, not a "log in again" UX.
- **Review follow-up → orphaned playlist on partial failure:** `generatePlaylist` does
  `createPlaylist → addTracks → save` with no compensation; if `addTracks`/`save` throws, an
  empty playlist is left on the user's account and a retry creates another. Acceptable for the
  single-user MVP; revisit (cleanup/compensation or create-last ordering) if it bites.
- **Review follow-up → >100-track cap:** `addTracks` is documented ≤100 URIs but
  `generatePlaylist` passes the matched URIs unguarded; a 100+-word sentence would 400 after the
  playlist is already created. Add a guard (or chunk into ≤100 batches) when long sentences matter.
- **Done when:** one API call turns a sentence into a real Spotify playlist on the user's account and records history. ✅ (live-verified)

---

## Iteration 4 — Frontend ✅ DONE (PR #17, #19; post-merge fix #20)

Preview-then-create browser flow (owner request, 2026-07-04): split the former single-shot
`POST /api/playlists/generate` into a **preview** step (decompose + match only, nothing
created) and a **create** step (build the playlist from the confirmed tracks + chosen
visibility), so the user sees the matched tracks before anything lands on their account —
locked in **ADR 0012**, which also resolves the deferred `public:false`-vs-"shareable link"
question from Iteration 3's review (visibility is now a user choice, defaulting to private).
Shipped: `POST /api/playlists/preview` and `POST /api/playlists/create` routes backing
`PlaylistManager.previewSentence` / `createFromTracks`; Server-Component homepage reads the
session cookie (ADR 0002) to decide logged-in vs logged-out and maps `?auth_error` to
friendly copy; `PlaylistGenerator` client component drives preview → matched tracks/unmatched
→ public/private `Switch` → create → shareable link, with loading/error states throughout;
`LogoutButton`; shadcn `input`/`switch`/`label` added, UI defines its own local mirror of the
track/phrase wire shape rather than importing server types (ADR 0008 pattern, keeps the
`ui`→`manager` lint boundary intact). Suite at 144.

- **Post-merge fix (PR #20):** the login link used `next/link`; its `href` 307-redirects
  cross-origin to Spotify's OAuth screen, and `Link`'s client-side RSC fetch hit a CORS wall
  following that redirect before falling back to a real navigation (login still worked, but
  with a visible failed-fetch flash). Swapped to a plain `<a href="/api/auth/login">` inside
  the existing `Button asChild` — a plain anchor always does a full navigation.
- **Landing note:** #18 was left targeting its stacked base branch and got merged there
  instead of `main`, so `main` briefly had #17's backend with no UI calling it; #19 re-landed
  #18's exact squash commit onto `main` (identical diff, no changes) to close the gap.
- **Done when:** a user completes the whole flow in the browser without touching the API
  directly. ✅ (live-verified against a real Spotify account)

---

## Iteration 5 — Persistence & history ✅ DONE

Past-playlists view reading the history `PlaylistResource` already persists (the
`(user_id, created_at DESC)` index in `db/init/002_playlist.sql` was added in Iteration 3
anticipating exactly this — **no migration this iteration**). Shipped: `PlaylistResource`
gained `listByUser` (newest-first `SELECT`, its own `PlaylistHistoryEntry` storage-shape type
per the ADR 0008 separation); `PlaylistManager.getHistory` delegates straight to it — a
**plain same-subsystem call, no manager-resource** (history is Playlist-owned data with no
Identity equivalent to route through; ADR 0009 only governs the token path). Frontend:
`PlaylistHistory` — a **server-rendered** component (no `"use client"`; only a native
`<details>` disclosure + links) fed by the homepage server component, which calls
`getHistory(userId)` directly (app → Manager, the same sanctioned lint boundary the routes
use) in a try/catch that degrades to a soft "Couldn't load your past playlists" line rather
than crashing the page; `PlaylistGenerator` now calls `router.refresh()` after a successful
create so the new row appears without a reload (same idiom as `LogoutButton`). Playwright MCP
added to `.mcp.json`. 6 new tests → suite 150 (4 real-Postgres `PlaylistResource` integration

- 2 `getHistory` manager units).

* **No new endpoint (YAGNI, not ADR-worthy):** the homepage is already a Server Component
  reading the session cookie, so it fetches history in-process via the Manager rather than
  adding a `GET /api/playlists` route — one less moving part; a route can be added later if a
  client-side consumer ever needs it. The app→Manager boundary is unchanged (routes already
  cross it), so nothing architectural was newly decided or relitigated.
* **Deferred → CI e2e:** Playwright MCP is wired for interactive browser verification, but an
  automated e2e suite in CI is not — it needs a stubbed Spotify OAuth (real consent can't run
  headless in CI). Revisit if regressions in the browser flow start slipping through.
* **Review follow-up → history read over-provisions its manager:** the homepage builds
  `createPlaylistManager()` to call `getHistory`, which transitively runs
  `createUserManager → createAuthEngine`, eagerly requiring the three `SPOTIFY_*` env vars for a
  query that only touches Postgres. Harmless today (those vars are always set once login works,
  and the read is wrapped in a try/catch), but it couples a DB read to Spotify config and wastes
  construction each render. The `requirePlaylistResource` guard already anticipates a
  cross-subsystem-free manager — a history-only factory (omit `userManagerResource`) would
  decouple it and make that guard reachable in production. Revisit if a lighter path is wanted.
* **Done when:** a logged-in user can revisit previously generated playlists. ✅ (verified by
  seeding a real history row + session cookie and rendering the live homepage; full browser
  OAuth login not re-driven this session — Playwright MCP loads next session)

---

## Iteration 6 — UX overhaul 🚧 IN PROGRESS (Setup ✅ · Design ✅ · Implement next)

Reframes the old "Advanced" iteration (scope note kept at the foot of this section) as a
UX-driven push (owner request, 2026-07-11, kicked off after Iteration 5 merged): make the app
feel like a real product — a designed, polished frontend with real UX care.

**Scope changed materially once the owner's sketch arrived (2026-07-12) — read this before
planning Implement:**

- **Manual song replacement (track swap) is DROPPED.** So is **album art**. The owner's design
  contains neither, and history stays text-only. This deletes the whole
  `SpotifySearchResponse → TrackCandidate → MatchedTrack → wire → UI` widening the earlier
  version of this section called for, and it also dodges Spotify CDN URL rot on old history
  rows. CLAUDE.md §9/§10 were corrected to match — song replacement is a **non-goal** again.
  Genre filtering remains out of scope (unchanged).
- **A live streaming progress view is ADDED**, and it is the centrepiece. The earlier claim in
  this section that the loading state is _"genuinely frontend-only"_ was **wrong**: the design
  asks for the phrase currently being searched, per-track states resolving one by one, and a
  running log ("queuing, breaking, number of attempts"). That is `PlaylistManager`'s
  backtracking loop's internal state, live — and `POST /api/playlists/preview` currently goes
  quiet for seconds and returns one finished blob. See "Implement phase" below.

Net effect: Implement is **less** full-stack surface than feared (no art/swap thread) but gains
one genuinely new capability (streaming).

**Decisions (2026-07-11 discussion):**

- **Design agreement medium: Figma via MCP** (owner's explicit choice; token cost of the
  Figma round-trip acknowledged and accepted). Owner supplies a general overview + low-fi
  sketch photos — no Figma files from the owner. Claude generates designs into Figma;
  agreement happens on the Figma canvas _before_ any code.
- **Skills installed:** `anthropics/skills@frontend-design` (official, typography/color/motion/
  spatial-composition pillars), `vercel-labs/agent-skills@web-design-guidelines` (audits UI
  against Vercel's Web Interface Guidelines), `wondelai/skills@web-typography` (dedicated
  typeface-pairing/type-scale diagnostic — added because `frontend-design` only covers pairing
  at a high level). Vendored under `.agents/skills/` (all markdown, no scripts) and symlinked
  into `.claude/skills/`, pinned by content hash in `skills-lock.json` — committed so a fresh
  clone/session has them without a network fetch, consistent with the repo's "shared agent
  config is committed" convention (`.gitignore`). All three passed Gen Agent Trust Hub + Socket
  scans. **`web-design-guidelines` scored Med Risk on Snyk** (vs. Low for the other two): its
  `SKILL.md` fetches its _actual rules_ at review time from
  `raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md` — a moving
  branch, so remote content becomes agent instructions. Reviewed and accepted (Vercel's own
  repo, public guidelines content, read-only review skill), but it is a prompt-injection surface
  worth knowing about; the vendored `SKILL.md` is 40 lines and cheap to re-read if it changes.
  Evaluated and rejected: multica-ai/andrej-karpathy-skills and mattpocock/skills (process
  discipline, redundant with the CLAUDE.md workflow).
- **Claude Design (claude.ai/design) not used** — built for component design systems,
  overkill at this scale.
- **MCPs:** Playwright MCP is project config (`.mcp.json`, added Iteration 5). **Figma MCP is
  _not_ in `.mcp.json`** — it is a claude.ai connector enabled per-user, so a fresh clone does
  **not** inherit it; whoever runs the Design phase must have the Figma connector authorized on
  their claude.ai account. Together they cover the design → implement → verify loop; nothing
  else needed.

### A. Setup ✅ DONE (PR #22)

Three design skills installed; branch cut. (Note: `feature/ux-overhaul` went stale — it holds
the pre-squash commits of what merged as `fd4d864`. Design landed on `feature/ux-design` off
`main` instead; the old branch can be deleted.)

### B. Design ✅ DONE (2026-07-12)

**Figma file:** https://www.figma.com/design/L0V2UO8eUMGVek76t5rfBV — `01 · Tokens`,
`02 · Screens — Desktop` (v1 at y=0, v2 y=1000/2000, **v3 y=4000 is the agreed design**),
`03 · Screens — Mobile` (v1 only, stale — redo on the v3 concept during Implement).

Round 1 (competing directions) was **cancelled**: the owner arrived with a low-fi sketch they
already liked, so the art direction was settled and the job became refine + extend, not pitch.

**The concept (v3, frames `D1`–`D3`):**

- **The white canvas is the artifact; the black box is the machine.** Black means exactly one
  thing — live machinery — so the canvas has **no status bar** at all.
- **The black box has two modes.** _Input:_ you type, footer reads `↵ spell it out`. On submit
  it becomes _logger:_ the sentence freezes (that is _why_ the input is disabled — it is now
  the readout), and the footer becomes the expand toggle (`▴ show log` / `▾ hide log`, plus
  `‹ new sentence` to return to input mode). Expanded, it takes the rail.
- **The log is semantically typed and honest:** `tokenise` / `try` / `hit` (green) / `miss`
  (red) / `split` (amber) / `done`. It narrates the real algorithm — longest-first at the span
  cap, miss, split into shorter spans, retry.
- **The playlist panel owns its own header and footer.** Create + Private/Public live in that
  **footer**, because visibility is a property of the playlist and Create is that list's
  terminal action — not homeless global controls. Rows scroll between a fixed header and fixed
  footer, so Create never drifts off-screen on a long sentence.
- **The sentence strip** above the list shows the sentence carved by the current grouping, so
  the backtracking stays visible without the list becoming a wall of boxes.
- **Type:** IBM Plex Mono, single family, hierarchy from weight/size/state-colour. No second face.

**Design decisions worth not re-deriving:**

- **Palette = Radix Colors** (radix-ui.com/colors) — Sand / Grass / Red. Chosen over hand-picked
  hexes because the scales guarantee contrast: the first pass used `#8A8A85` for muted text,
  which **failed contrast at ~3:1**; `sand-11` (`#63635E`) is 5.5:1 on white.
- **Spotify green (`#1ED760`) is CTA-only, never a semantic colour.** Spotify's design
  guidelines (developer.spotify.com/documentation/design) forbid using their green for
  non-Spotify UI, so "found" uses Radix Grass instead. CTA copy must be one of their approved
  strings — **`PLAY ON SPOTIFY`**, not an invented label. Their logo must appear as attribution
  on Spotify-derived content (the frames carry a placeholder slot; drop in the official asset —
  recreating or altering the mark is forbidden). Their metadata sizing rules (track ≤23 chars,
  artist ≤18) size the track row.
- **The input's character counter reads `n / 100`** because ADR 0003 caps the playlist name at
  100 chars and the name _is_ the sentence. The UI limit is the code's limit, not an invented one.

**Known gaps in the Figma file — accepted, not blocking.** Figma's Starter-plan MCP call limit
ended the session's writes early; the owner reviewed what was there and **signed off on v3 as
it stands** (2026-07-12) rather than spend another session completing the file. The design
intent is fully established by `D1`–`D3`; the gaps below are variations to be resolved in code,
where they are easier to get right anyway. Do **not** treat them as open design questions:

- **Long-sentence scroll case and the created state have no frames.** Both are settled in
  principle: scroll = the playlist panel's fixed header/footer with `overflow-y: auto` on the
  rows between them (so Create never drifts off-screen); created = a footer swap — the
  visibility toggle becomes static text, `Create playlist` becomes `PLAY ON SPOTIFY`.
- **Cosmetic bug in `D2`/`D3`:** the log's kind column is 52px, so `tokenise` clips to `token`.
  It needs ~62px. Figma artefact only — do not reproduce it in code.
- **Mobile frames are stale v1.** Redo them on the v3 concept during Implement. The rail must
  collapse: history behind a disclosure, and the black box (input/logger) docks to the bottom.

### C. Implement — next (one session per chunk)

shadcn/ui + Tailwind (ADR 0001). Tests alongside (CLAUDE.md §7).

**The long pole is streaming preview — now locked in [ADR 0013](decisions/0013-streaming-preview-progress.md)
(read it before writing code; it amends ADR 0012).** In short: `PlaylistManager` emits progress
through an **optional injected `onProgress` callback** (the Manager already owns the orchestration
loop, so that is where "what am I doing right now" belongs — CLAUDE.md §4); the **route** adapts
that callback into a streamed **NDJSON** response. Engines stay pure and untouched,
`SpotifyResource` untouched, no layer skipping. The callback being optional means every existing
caller and test keeps working, and the loop is testable by collecting events into an array — no
HTTP needed.

Two contract changes fall out, both recorded in ADR 0013: the terminal `done` event carries the
full track list (so ADR 0012's "create trusts the client-confirmed tracks" still holds), and
**`422` (no full cover) becomes a terminal event rather than a status code** — by the time the
matcher knows, the `200` and its headers are already on the wire.

- **Accessibility is an acceptance criterion, not a nicety.** The frames set the log at **11px
  — too small; use ≥12px.** Every screen must survive **200% zoom** without truncation, keep
  visible keyboard focus, and respect `prefers-reduced-motion` (the chip/row re-flow is the
  whole delight moment, so it needs a static fallback). Run the `web-design-guidelines` skill
  against the **code** once it exists — it audits UI code, so it was deliberately _not_ run
  against the Figma file.
- **Frontend surfaces:** `src/app/page.tsx`, `src/components/PlaylistGenerator.tsx`,
  `src/components/PlaylistHistory.tsx`, `src/app/globals.css`, `src/components/ui/*`.
  `globals.css` is still **stock shadcn** (every colour zero-chroma) with a hardcoded
  `text-red-700` blackletter title in `page.tsx` — the Radix token layer replaces both.
- **Backend surfaces:** `src/server/playlist/managers/PlaylistManager.ts` (emit progress) and
  `src/app/api/playlists/preview/route.ts` (stream it). `SpotifyResource` and both Engines are
  **unchanged** — the art/swap widening is cancelled.
- **Verify** with Playwright MCP driving the full flow (login → sentence → live search →
  create → history) at desktop + mobile, against the v3 frames.

**Done when (Setup):** skills installed, section on `main`, branch exists. ✅
**Done when (Design):** owner has agreed the visual direction and screen set in Figma. ✅
**Done when (Implement):** a logged-in user completes the whole flow in the browser against the
agreed design, watching the search happen live; Playwright screenshots match the v3 frames at
desktop + mobile.

### Filed away (not doing)

Manual song replacement and album art — pulled into this iteration on 2026-07-11, **dropped on
2026-07-12** when the design landed without them. Genre filtering remains a non-goal
(CLAUDE.md §10). If swap is ever revived: `SpotifyResource.searchTracks` already fetches **50**
results per search and `SpotifyEngine.findMatch` throws all but the first away (`tracks.find`),
so alternatives cost **zero** extra Spotify calls and need no new endpoint — and since every
alternative is title-equal under ADR 0003, a swap can never break the sentence.
