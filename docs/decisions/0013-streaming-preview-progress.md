# 0013 — Preview streams progress; the Manager emits it

Date: 2026-07-12 · Status: accepted · **Amends [ADR 0012](0012-preview-then-create-split.md)**
(preview is no longer a single JSON response). Create is untouched.

## Context

The Iteration 6 design ([roadmap](../roadmap.md) Iteration 6) makes a **live progress view** the
centrepiece: the user watches their sentence get carved into real song titles — the phrase
currently being searched, tracks resolving one by one, and a running log of what the matcher is
doing ("trying a 5-word span… no track… breaking it into shorter spans…").

That is not a frontend concern. It is `PlaylistManager.matchSentence`'s backtracking loop's
internal state. Today `POST /api/playlists/preview` calls that loop, goes quiet for several
seconds while it fans out across Spotify searches, and returns one finished JSON blob (ADR 0012).
There is nothing to observe: the interesting behaviour — longest-first grouping at the span cap,
a miss, backtracking to shorter spans — is invisible, and the wait is dead time.

The loop already takes seconds of real work. Streaming it doesn't add latency; it _fills_ latency
that already exists.

## Decision

**1. `PlaylistManager` emits progress through an injected callback.**
`previewSentence` / `matchSentence` take an **optional** `onProgress` callback. The Manager already
owns the orchestration loop (CLAUDE.md §4) — emitting "what I am doing right now" from the
component that decides what to do next is exactly where coordination belongs.

- `SentenceEngine` and `SpotifyEngine` stay **pure** and are not touched. They do not know progress
  exists.
- `SpotifyResource` is not touched.
- The callback is **optional**, so every existing caller and unit test keeps working unchanged, and
  the loop stays testable by collecting emitted events into an array — no HTTP, no stream.

**2. The route adapts callback → stream. Transport is NDJSON.**
`POST /api/playlists/preview` returns a streamed `application/x-ndjson` body: one JSON object per
line. The Manager knows nothing about HTTP; the route knows nothing about matching.

NDJSON over Server-Sent Events because:

- **Preview is a POST** (the sentence is in the body). The browser's `EventSource` API — SSE's main
  advantage — is **GET-only**, so we would be hand-parsing SSE framing over `fetch` anyway, at which
  point its `event:`/`data:` ceremony buys nothing.
- **SSE's auto-reconnect is actively wrong here.** A dropped connection reconnecting would restart a
  multi-second Spotify fan-out from scratch. We want the request to simply fail.
- NDJSON is a `TextDecoder` plus a line split. Simplest thing that works (CLAUDE.md §7, YAGNI).

**3. Event shape (the wire contract).**

```jsonc
{ "type": "tokenised", "words": 11 }
{ "type": "try",   "phrase": "i will always love you", "words": 5 }
{ "type": "hit",   "phrase": "i will always love you", "track": { "id": "…", "uri": "…", "name": "…", "artistNames": ["…"] } }
{ "type": "miss",  "phrase": "i miss you every single" }
{ "type": "split", "phrase": "i miss you every single" }
// exactly one terminal event, always last:
{ "type": "done",  "ok": true,  "tracks": [ { "phrase": "…", "track": { … } } ] }
{ "type": "done",  "ok": false, "unmatched": ["…"] }   // no full cover — ADR 0003, nothing created
{ "type": "error", "message": "…" }
```

**The terminal `done` event carries the complete result.** This preserves ADR 0012's central
decision — create trusts the client-confirmed tracks and never re-searches — because the client
ends up holding exactly the track list it will echo to `POST /api/playlists/create`. The stream is
an _addition_ to the preview response, not a replacement for it.

**4. Status codes move, for the ones that can't.**
`401` (no session) and `400` (blank sentence) are still real HTTP statuses — they are decided
_before_ the stream opens. But **`422` (no full cover) becomes a terminal `done` event with
`ok: false`**, not a status code: by the time the matcher knows the sentence can't be covered, the
response has already been sent with `200` and headers are on the wire. Mid-stream failures are an
`error` event for the same reason.

## Alternatives considered

- **Server-Sent Events.** Rejected — see above: `EventSource` is GET-only so we'd hand-roll the
  parsing regardless, and its auto-reconnect would silently restart an expensive search.
- **Poll a job id** (`POST /preview` → `202` + id, client polls `GET /preview/{id}`). Rejected: needs
  server-side job state (the app currently has none), turns one request into N, and adds latency
  granularity limits for no benefit. Real overkill for a single-user MVP.
- **Return an `AsyncIterable` from the Manager instead of taking a callback.** Rejected: it forces
  every caller to consume an iterator even when they only want the final result, and it makes the
  existing non-streaming call sites and their tests more awkward, not less. The optional callback is
  additive and leaves every current caller untouched.
- **Fake it: keep one request, animate the result client-side.** Rejected — dishonest. The user would
  wait in silence and then watch a recording of a search that already finished. The design asks for
  the real attempt count; a replay cannot supply one.
- **Emit progress from `SentenceEngine`.** Rejected: it would make a pure engine stateful and
  I/O-aware, violating CLAUDE.md §4. The engine generates candidates; it does not know which were
  tried or whether they matched — only the Manager does.

## Consequences

- The hardest, most invisible part of the app — backtracking — becomes the thing the user watches.
  The wait stops being dead time.
- `previewSentence`'s contract widens (an optional callback) and the preview **route**'s contract
  changes shape (streamed NDJSON; `422` becomes a terminal event). ADR 0012's preview/create split,
  its "create trusts the client" rule, and the create route itself are all **unchanged**.
- The frontend can no longer `await res.json()` on preview. It reads the body stream and drives UI
  state from events. The `PlaylistGenerator` client component is rewritten around this.
- Testing the loop's progress needs no HTTP: pass a callback, assert on the collected events.
- A client that disconnects mid-search leaves the server's fan-out running to completion. Acceptable
  for the single-user MVP (the per-request `maxSearches` budget from Iteration 3 already bounds the
  worst case); revisit with an `AbortSignal` if it ever matters.
