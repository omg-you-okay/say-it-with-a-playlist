# Say It With a Playlist — Project Brief (Stack-Agnostic)

> Purpose of this document: complete project context for an AI coding agent or new developer. It describes **what** the system does, **how** it is structured, and **how** development proceeds — without prescribing languages, frameworks, or tooling.

---

## 1. The Idea

A web application where a user signs in with their Spotify account, types a free-text sentence, and the system builds a real Spotify playlist whose song titles — read in order — spell out that sentence. The user gets a direct, shareable link to the playlist on their own account.

Example: "I will always love you" might become the tracks _"I"_, _"Will"_, _"Always Love You"_ — or _"I Will"_, _"Always"_, _"Love You"_ — whichever grouping yields real, matchable tracks.

**Audience:** any Spotify user. No special roles or permissions beyond standard delegated account access.

---

## 2. Core User Flow

1. User opens the app and clicks "Log in with Spotify"
2. User is redirected through Spotify's OAuth consent flow; on success, the backend stores their tokens and establishes a session
3. User types a sentence into a text input
4. The system decomposes the sentence into phrase groupings, searches Spotify for tracks whose titles match each grouping, and backtracks/retries until the whole sentence is covered (or it gives up)
5. The system creates a playlist on the user's Spotify account containing the matched tracks in sentence order
6. User receives the playlist link; the result (tracks + link) is displayed in the UI
7. Generated playlists are saved as history the user can revisit later

---

## 3. The Heart of the System: Sentence Decomposition

This is the core technical challenge and the most important logic to get right. Requirements:

- **Tokenisation:** split the sentence into words
- **Multi-word groupings:** candidate phrases can span multiple consecutive words ("Always Love You" as one track), generated in a defined priority order
- **Substitutions:** apply character/word substitutions when matching (known examples: to→2, you→U, for→4, are→R; the full list is locked in ADR 0003 — see §8)
- **Backtracking:** if a grouping can't be matched to a real track, abandon it, try the next candidate grouping, and re-derive the groupings for the remainder of the sentence. The search continues until the full sentence is covered or all candidates are exhausted
- **Match quality:** a search result counts only if the track title is a "good enough" match for the phrase (exactness rules locked in ADR 0003 — see §8)

**Critical separation of concerns (locked decision):**

- Candidate generation is **pure logic** — it produces groupings in priority order with no knowledge of whether they match anything. It is independently unit-testable with no external dependencies
- Match validation is a separate concern that talks to the external music API
- The **orchestration loop** (try a candidate → validate → on failure, backtrack and try the next) lives in a coordinating component, _not_ inside either of the two concerns above. Coordination logic and business logic are kept apart

---

## 4. Architecture Principles (Locked Decisions)

The project follows the **iDesign methodology** — decomposition by volatility, not by feature. These rules are deliberate, already debated, and must not be violated by generated code:

1. **Single deployable monolith** with two strictly separated **logical subsystems**:
   - **Identity** — sign-in, OAuth handling, user records, token storage
   - **Playlist** — sentence decomposition, music-API integration, playlist creation, history
     Boundaries are enforced by folder/namespace discipline, not the compiler. Respecting them keeps a future extraction into separate services a refactor rather than a rewrite.

2. **Three-layer structure within each subsystem:**
   - **Managers** — orchestrate use cases; own coordination logic and sequencing ("if this fails, try that")
   - **Engines** — encapsulate volatile business logic (e.g. candidate generation; match-quality judgement)
   - **Resources** — encapsulate access to storage and external APIs

3. **Call-direction rules (hard constraints):**
   - Managers call Engines and Resources
   - **Engines never call other Engines**
   - Layers are never collapsed or skipped for convenience
   - Managers do not call Managers directly. When one subsystem needs something from another, the caller's subsystem owns a **manager-resource** — a Resource whose "external system" is the other subsystem's **Manager** (its public front door). It is named after the target manager (`<TargetManager>Resource`) and is the one sanctioned cross-subsystem touchpoint (ADR 0009). Specifically: the Playlist subsystem obtains a _fresh_ access token via a `UserManagerResource` that calls `UserManager.getFreshAccessToken` — it does **not** read Identity's token store directly (a raw read can't refresh an expired token)

4. **Component inventory (names are part of the shared vocabulary):**
   - Identity: UserManager, AuthEngine, UserEngine, UserResource, TokenResource (Identity-private)
   - Playlist: PlaylistManager, SentenceEngine, SpotifyEngine, SpotifyResource, PlaylistResource, UserManagerResource (the cross-subsystem adapter to Identity, added Iteration 3)
   - The backtracking orchestration loop lives in **PlaylistManager**

---

## 5. Authentication & Security Model (Locked Decisions)

- Spotify **OAuth 2.0 Authorization Code Flow** — required because the app performs delegated actions (creating playlists) on the user's account and needs refresh capability
- **The backend holds all tokens.** Access and refresh tokens never reach the frontend
- Token refresh is handled server-side, and is **serialized on a Postgres row lock** — concurrent refreshes could otherwise write a dead refresh token over a live one and log the user out permanently (ADR 0017)
- How the frontend knows the user is logged in: **decided** — httpOnly signed session cookie (ADR 0002, see §8)
- API credentials/secrets live in environment configuration, never in source

**A hard external ceiling (not a bug, and no code fixes it):** Spotify rewrote Development Mode on 2026-02-11. This app's client ID postdates that, so it is capped at **5 test users, each needing Spotify Premium, each added by hand** in the Spotify dashboard. Extended Quota Mode requires a registered business and 250k MAU. The app is deployed and live, but it cannot be _public_. Because Spotify's allowlist is the gate, the app deliberately has **no rate limiting and no abuse protection** — that absence is a decision (ADR 0016), not an oversight.

---

## 6. Data to Persist

A relational store holding:

- **Users** — app-side user records linked to their Spotify identity
- **Tokens** — access + refresh tokens per user (owned by Identity's `TokenResource`; Playlist obtains a fresh token through the `UserManagerResource` adapter, not by reading this table directly — ADR 0009)
- **Playlist history** — record of generated playlists per user (sentence, tracks, link, timestamp)

---

## 7. Development Workflow

This is as important as the code itself; the project deliberately practices professional engineering discipline:

- **Branching:** GitHub Flow — `feature/*`, `fix/*`, `chore/*` branch off `main` and land back via PR into `main` (always deployable). _(Updated from the original GitFlow `develop` model — see docs/decisions/0007.)_
- **CI grows with the code:** the pipeline starts minimal and gains steps (build, test, lint) only as the corresponding code exists — never failing checks for an app that isn't there yet. Branch protection on `main` requires the CI check to pass
- **Commit format:** `type(scope): description`
- **Tests are written alongside implementation, not after:** core logic gets unit tests before moving on; every endpoint gets an integration test before shipping; auth testing is non-negotiable
- **Ship small, ship often:** tiny scope per feature, every merge is deployable
- **YAGNI / simplest-thing-first:** build only what the current phase needs; make it work simply before making it clean; make it scale only when a real problem appears
- **Decisions are logged:** architectural choices go into a decision log with rationale, alternatives, and trade-offs. Existing locked decisions (above) are not relitigated by generated code

---

## 8. Formerly Open Decisions (all resolved — answers live in ADRs; do not re-decide)

| Question                                  | Resolved in                                                                                                                                             |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Good enough" track-title match           | ADR 0003 — exact equality after normalization                                                                                                           |
| Behaviour when no match exists            | ADR 0003 — no playlist created; response lists the unmatched words/phrases                                                                              |
| Frontend session strategy after OAuth     | ADR 0002 — httpOnly, SameSite=Lax signed JWT cookie; payload = app user id                                                                              |
| Full, agreed list of substitution rules   | ADR 0003 — config-driven map in SentenceEngine (to→2, you→U, one→1…, and→&…); extended by ADR 0015 (too→2)                                              |
| Auto-generated playlist naming convention | ADR 0003 — the sentence itself (≤100 chars); branding in the description                                                                                |
| Production hosting + the secrets strategy | ADR 0016 — Vercel Hobby + Neon, both free; secrets in platform env config, prod `SESSION_SECRET` never shared with local. Runbook: `docs/deployment.md` |

---

## 9. Phase Plan (high level — scope only; live status per phase is in `docs/roadmap.md`)

0. **Foundations** — repo, branching, CI, containerised local dev environment (API + database + reverse proxy), workspace/solution scaffolding with the subsystem folder structure
1. **OAuth (Identity subsystem)** — full login round-trip: OAuth URL construction, callback handling, token exchange and storage, refresh logic, login/callback/refresh endpoints
2. **Sentence decomposition (Playlist subsystem, pure logic)** — tokenisation, candidate grouping generation, substitutions, match-quality rule, search integration, the backtracking orchestration loop; heavily unit-tested
3. **Playlist creation** — create playlist, add tracks, persist history, end-to-end generate endpoint
4. **Frontend** — login button, OAuth callback handling, sentence input, result display, loading and error states
5. **Persistence & history** — past-playlists view
6. **UX overhaul** — designed, polished frontend via a Figma-via-MCP design round-trip. Its centrepiece is a **live streaming progress view**: the decomposition loop emits progress as it searches, so the user watches the sentence get carved into real song titles instead of staring at a spinner. Manual song replacement and album art were briefly in scope and are **out** again (the agreed design has neither); genre filtering was never in scope. _(Reframed 2026-07-11 from the original "Advanced / explicitly out of MVP scope" phase; scope re-cut 2026-07-12 once the design landed — see `docs/roadmap.md` Iteration 6 for the live workflow and decisions.)_

---

## 10. Non-Goals (MVP)

- Genre filtering
- Manual song replacement (swapping a matched track)
- Album art anywhere in the UI
- Streaming platforms other than Spotify
- Social features (sharing/following)
- Native mobile app

_(Manual song replacement and album art were pulled into the Iteration 6 UX overhaul on
2026-07-11 and dropped again on 2026-07-12: the agreed design contains neither, and the
iteration's effort goes into the live streaming progress view instead. See §9 and
`docs/roadmap.md` Iteration 6 → "Filed away".)_

---

## 11. Current State

This section intentionally holds **no volatile status** — that belongs in the roadmap, so it stays correct as features land instead of going stale in a file that is loaded into every session.

- **Where the project is, the per-iteration breakdown, and each iteration's "done when":** `docs/roadmap.md` — the single source of truth for status.
- **Locked architectural decisions (the _why_):** `docs/decisions/` (ADRs).

Start a feature with `/kickoff` (loads the next iteration + its constraints, branches, plans) and close it with `/wrap` (writes status/decisions back so the next clean session is correct).
