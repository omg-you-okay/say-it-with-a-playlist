# 0018 — End-to-end tests in a real browser, in CI

Date: 2026-07-16 · Status: accepted · Closes the "CI e2e" debt deferred since Iteration 5
(`docs/roadmap.md`). Does not amend any locked decision — it adds a test layer, it changes no
runtime behaviour, matching rule, or architecture boundary.

## Context

Iteration 6 shipped **five** layout bugs to `main` past a fully green pipeline — lint, format,
typecheck, and (by then) 188 unit and component tests. Every one was width- or scroll-dependent:
the expanded log grew the page instead of scrolling inside its box; the console stopped filling the
rail; the sentence strip's nested-flex wrappers stranded the untried tail on its own line; a
reserved scrollbar gutter painted a white strip down the track list; and an unanchored `sr-only`
span (`position: absolute` with no positioned ancestor) escaped the log's overflow box and
stretched the document by one span per line — a phantom page scroll that grew with every backtrack.

None of these were catchable by the existing suite, and the reason is structural, not a gap in
diligence: **jsdom has no layout engine.** It does not compute `scrollWidth`, `clientHeight`, or
box geometry, so no assertion running under jsdom — however well written — can see an element that
has escaped its scroll container or a page that has grown sideways. Every one of the five was found
the same way: a human opened the running app in a real browser and looked. Now that the app is
deployed (Iteration 8), that class of bug reaches users between the commit and the next time
someone happens to look.

The suite has been "deferred → CI e2e" since Iteration 5. The blocker recorded there was that the
browser flow starts at Spotify's OAuth consent screen, which needs a real Premium account on the
5-person allowlist (ADR 0016) and cannot run headless in CI. That blocker turned out to be
avoidable (see below), so the debt is now payable.

## Decision

Add a **Playwright** end-to-end suite that drives the live search view in a **real (Chromium)
browser**, on both a desktop and a mobile viewport, and runs it in CI.

Two seams make it hermetic — no Spotify account, no OAuth, no network:

1. **The session is minted, not walked.** `e2e/session.ts` signs a session cookie with the app's
   own `createSessionToken` and a fixed test `SESSION_SECRET`, set on both the Playwright process
   and the server it boots (`playwright.config.ts`). Walking Spotify's consent screen was the
   original blocker; it is also the wrong thing to test — that flow is Spotify's code, and ours is
   already covered by the OAuth integration tests. Minting with the app's real signing core keeps
   the fake honest: if session signing changes, the e2e suite fails rather than authenticating
   against a format the app no longer accepts.

2. **The preview stream is stubbed at `fetch`.** `e2e/fixtures.ts` patches `window.fetch` (via
   `addInitScript`, before navigation) to serve a scripted NDJSON event sequence as a genuine,
   progressively-chunked `ReadableStream` — deliberately **not** Playwright's `route.fulfill`,
   which delivers the whole body in one chunk and would let the client parse every event in a
   single pass, hiding exactly the progressive-render bugs the suite exists to catch.

Scope of the assertions is deliberately narrow: **the geometry jsdom cannot measure.** The state
machine's behaviour (backtracking, pruning, the footer swap, the honest failure copy) is already
unit-tested in `PlaylistWorkspace.test.tsx` and is not re-litigated here. The first specs assert no
horizontal page overflow while the sentence is carved into tracks (both viewports), and that the
expanded log's overflow lives inside its own box rather than growing the document (desktop, where
the pinned-viewport layout is an invariant) — direct regression guards for the Iteration 6 bugs.

Mechanics: the suite runs against the **production build** (`next start`, not `next dev` —
dev-mode React and Turbopack output differ from what ships). `pnpm e2e` builds then runs it locally;
CI builds as its own step (a build break should read as a build failure, not a mysterious e2e
timeout) and Playwright only serves that output. CI reads history/profile against its Postgres
service through `Promise.allSettled`, so the unknown e2e user degrades to an empty history rather
than failing the render — no seed step required.

## Alternatives considered

- **A real OAuth login in CI** — rejected. It needs a Premium account on Spotify's manual
  allowlist (ADR 0016), which a CI runner will never have, and it would test Spotify's code, not
  ours. Minting the cookie from the app's own signing core is both hermetic and a truer test of the
  part we own.
- **`page.route` + `route.fulfill` for the preview response** — rejected. Single-chunk delivery
  collapses the progressive NDJSON render into one pass, so the live-progress view could be
  completely broken and the test would still pass. A real chunked `ReadableStream` is the only stub
  that exercises the reader-plus-render path where Iteration 6's bugs lived.
- **Testing against `next dev`** — rejected. The shipped bugs were in production output; dev-mode
  React and Turbopack differ from it. Test what deploys.
- **A visual-regression / screenshot-diff tool** — not now. Pixel diffs are flaky across
  font-rendering and OS/browser versions and would train the "re-run until green" habit the config
  header warns against. Measuring specific geometry (`scrollWidth`, overflow) is a precise,
  non-flaky assertion about the exact failure class. Revisit if a bug appears that only a pixel
  diff could catch.
- **Reintroducing the Playwright MCP server** — rejected, and orthogonal. Iteration 8 removed the
  MCP server (an interactive tool for the agent, which never worked on this machine). This is
  Playwright as a **devDependency with real specs in CI** — a different thing, and the one that
  actually prevents regressions.

## Consequences

- CI grows a browser install (`playwright install --with-deps chromium`) and an e2e step. Both
  viewport projects are Chromium-based, so only Chromium is installed. The suite runs against the
  existing Postgres service and the build already produced — no new services.
- The class of bug that jsdom is blind to now has a home. The suite is seeded with two specs; new
  layout invariants get added here as they are discovered, rather than relying on someone looking.
- The stubbing seam is a maintenance surface: the fixtures encode the NDJSON contract shape, so a
  contract change must update them. This is acceptable and consistent with the ADR 0008 pattern of
  a UI-local mirror of the wire shape; the `preview-stream.contract.test.ts` type assertion (ADR
  0013 / Iteration 7) still guards the manager↔UI shape at `typecheck` time.
- These are hermetic by construction. A future desire to smoke-test the _real_ Spotify path (live
  OAuth, live search) is explicitly out of scope and would need a different, non-CI harness — the
  5-user allowlist ceiling (ADR 0016) makes an automated real-account test impossible anyway.
