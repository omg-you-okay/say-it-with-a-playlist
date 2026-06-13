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
- **Substitutions:** apply character/word substitutions when matching (known examples: to→2, you→U, for→4, are→R; the full list is an open decision — see §8)
- **Backtracking:** if a grouping can't be matched to a real track, abandon it, try the next candidate grouping, and re-derive the groupings for the remainder of the sentence. The search continues until the full sentence is covered or all candidates are exhausted
- **Match quality:** a search result counts only if the track title is a "good enough" match for the phrase (exactness rules are an open decision — see §8)

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
   - Managers do not call Managers directly; cross-subsystem data sharing happens through a **shared data resource** (specifically: the Playlist subsystem reads the user's access token from the same token store the Identity subsystem writes to — not by calling into Identity)

4. **Component inventory (names are part of the shared vocabulary):**
   - Identity: UserManager, AuthEngine, UserEngine, UserResource, TokenResource
   - Playlist: PlaylistManager, SentenceEngine, SpotifyEngine, SpotifyResource, PlaylistResource
   - The backtracking orchestration loop lives in **PlaylistManager**

---

## 5. Authentication & Security Model (Locked Decisions)

- Spotify **OAuth 2.0 Authorization Code Flow** — required because the app performs delegated actions (creating playlists) on the user's account and needs refresh capability
- **The backend holds all tokens.** Access and refresh tokens never reach the frontend
- Token refresh is handled server-side
- How the frontend knows the user is logged in (session cookie vs app-issued token) is an **open decision** that must be made before backend auth work begins (see §8)
- API credentials/secrets live in environment configuration, never in source

---

## 6. Data to Persist

A relational store holding:

- **Users** — app-side user records linked to their Spotify identity
- **Tokens** — access + refresh tokens per user (written by Identity, read by Playlist — the one sanctioned cross-subsystem touchpoint)
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

## 8. Open Decisions (do not assume — these need explicit answers)

| Question                                                                                                       | Needed before       |
| -------------------------------------------------------------------------------------------------------------- | ------------------- |
| What counts as a "good enough" track-title match (exact? case-insensitive? partial?)                           | Decomposition logic |
| Behaviour when no match exists after exhausting all options (partial playlist? error? user picks replacement?) | Decomposition logic |
| Frontend session strategy after OAuth (session cookie vs app-issued token)                                     | Backend auth work   |
| Full, agreed list of substitution rules                                                                        | Decomposition logic |
| Auto-generated playlist naming convention                                                                      | Playlist creation   |

---

## 9. Phase Plan (high level)

0. **Foundations** _(in progress)_ — repo, branching, CI, containerised local dev environment (API + database + reverse proxy), workspace/solution scaffolding with the subsystem folder structure
1. **OAuth (Identity subsystem)** — full login round-trip: OAuth URL construction, callback handling, token exchange and storage, refresh logic, login/callback/refresh endpoints
2. **Sentence decomposition (Playlist subsystem, pure logic)** — tokenisation, candidate grouping generation, substitutions, match-quality rule, search integration, the backtracking orchestration loop; heavily unit-tested
3. **Playlist creation** — create playlist, add tracks, persist history, end-to-end generate endpoint
4. **Frontend** — login button, OAuth callback handling, sentence input, result display, loading and error states
5. **Persistence & history** — past-playlists view
6. **Advanced** _(explicitly out of MVP scope)_ — manual song replacement, genre filtering

---

## 10. Non-Goals (MVP)

- Manual song replacement after generation
- Genre filtering
- Streaming platforms other than Spotify
- Social features (sharing/following)
- Native mobile app

---

## 11. Current State

This section intentionally holds **no volatile status** — that belongs in the roadmap, so it stays correct as features land instead of going stale in a file that is loaded into every session.

- **Where the project is, the per-iteration breakdown, and each iteration's "done when":** `docs/roadmap.md` — the single source of truth for status.
- **Locked architectural decisions (the _why_):** `docs/decisions/` (ADRs).

Start a feature with `/kickoff` (loads the next iteration + its constraints, branches, plans) and close it with `/wrap` (writes status/decisions back so the next clean session is correct).
