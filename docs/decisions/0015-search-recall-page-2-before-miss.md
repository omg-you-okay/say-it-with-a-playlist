# 0015 — Search recall: page 2 before declaring a miss, and an honest failure report

Date: 2026-07-12 · Status: accepted · **Amends [ADR 0003](0003-matching-and-naming-rules.md)**
(adds one substitution). Also amends the terminal `done` event shape locked in
[ADR 0013](0013-streaming-preview-progress.md) (one additive field, same category as Iteration 6's
`index`/`wordCount`/`searches`/`tokens`).

## Context

The owner reported the app "breaks" on ordinary sentences containing an article ("I am eating a
salad" reads as broken), and that the failure message ("Try rewording: …") "makes little sense."

A live session against real Spotify (preview path only; nothing created) found the cause and
ruled out a fix. Findings, measured, not assumed:

- **The backtracking loop itself is correct.** "I am eating a salad" actually succeeds today —
  there is a real track "Eating a Salad." What fails is any sentence that forces the loop down to
  a **bare tiny word**: `q=a` returns 50 popularity-ranked tracks with no track literally titled
  "A," so the position dead-ends. Same for `i`, `the`, `an`, `at`, `of`, `my`, `too`.
  "I am eating a quesadilla for lunch today" failed on `"a"` after 20 searches.
- **Every one of those words has an exact-title track on page 2 of the identical query**
  (Spotify's `offset=50`, one page past the default 50-result page): "A" — Midwestern Roadkill,
  "I" — Aphex Twin, "the" — bonnibel !, "Too" — Sarah Kinsley, "an" — Alicks. One extra page on a
  miss rescues all of them.
- **Multi-word phrases never benefit from the same retry.** A follow-up probe paged 17 phrases
  that had missed on page 1 ("jumps over the lazy dog," "you ever think about me," "a quesadilla
  for lunch," …) — **zero** found an exact title on page 2. A real title of any length already
  ranks highly in Spotify's own search; there is nothing to gain by paging further for those, and
  doing so anyway would cost a real search on every multi-word miss for no benefit.
- **Spotify's `track:"…"` field filter is worse, not better**, as an alternative considered and
  rejected: it returns fewer results per page (25 vs. 50) and the exact tiny-word titles never
  appeared even 1000 results deep.
- **Fuzzy matching** was also considered and rejected outright — it would relitigate ADR 0003's
  exact-after-normalization rule, which is not in question here; the problem was recall (which
  page of results got looked at), not match quality.
- **An LLM/AI agent** was suggested by the owner and rejected: the bottleneck was never
  understanding the sentence — it was that the right tracks weren't on the first results page. An
  LLM does not fix that, and would add cost and latency to solve a problem that doesn't exist.
- **The failure message was actively misleading twice over.** It listed every candidate grouping
  that failed at the deepest position reached ("a quesadilla for lunch today, a quesadilla for
  lunch, a quesadilla for, a quesadilla, a"), reading as five separate problems when it is one
  stuck word. Worse, when the per-request search budget (`maxSearches`, ADR 0003/Iteration 3) ran
  out, the matcher cached a fake "no match" for anything not yet searched — so a budget give-up
  and a genuine "no song is titled this" were indistinguishable to the user.
- **The substitution map (ADR 0003) has `to→2` and `two→2` but not `too→2`)** — an 18-word test
  sentence failed on the single word "too" after 67 searches for exactly this reason.

## Decision

**1. Deepen the search once, only for bare/short candidates, on a miss.**
`SpotifyResource.searchTracks` gains an optional `offset` parameter (default 0), passed straight
into the existing search request. `PlaylistManager`'s `findTrack` retries a page-1 miss at
`offset = 50` (Spotify's page size) **only when the candidate is 1 word** (`deepSearchMaxWords`,
injectable, default 1 — the exact bound the probe measured, not guessed). Both pages count
against the existing `maxSearches` budget; a re-tried variant is still served from the per-request
memo, so the second page is fetched at most once per distinct variant.

**2. `too→2` is added to the ADR 0003 substitution map.**

**3. `SpotifyEngine.findMatch` prefers a clean title among the tracks that already match.**
ADR 0003 still decides _whether_ a track matches (exact after normalization, title side
tail-stripped). Among the tracks that pass that rule, one whose title needed no stripping at all
("Fox Jumps") is preferred over one that did ("Fox Jumps (To the Rave)") — the clean title reads
better in the finished playlist.

This is deliberately implemented as _filter by the ADR 0003 rule, then prefer within the
survivors_, not as "try the unstripped comparison first." The latter looks equivalent and is not:
`normalize("Call Me (Live)")` is `"call me live"` (the parens become separators), so an
unstripped-first comparison would let the phrase "call me live" match **Call Me (Live)** — a match
ADR 0003 explicitly rejects, since it strips the tail before comparing and sees only "call me".
The preference must never admit a match the rule refuses; a test pins this.

**4. The failure report names the single word the search got stuck on, not every grouping tried.**
The deepest word position any backtracking path reached is provably the word to blame: if that
position's own 1-word candidate had hit, its remainder would have failed at a deeper position,
contradicting "deepest." `PlaylistManager` therefore records only 1-word-candidate misses (a
longer span that misses always has a shorter candidate left to try at the same index, so it can
never be the global deepest failure).

**5. The terminal `done: false` event gains one additive field:
`reason: "no_match" | "budget"`** — whether the sentence genuinely could not be spelled, or the
`maxSearches` budget stopped the search before it finished.

The give-up is tracked by a single request-scoped flag set **the moment a lookup is refused a
search it wanted to make** — not inferred from which position failed last, and not from
`searchesUsed >= maxSearches`. Both of those are wrong, in opposite directions:

- _Per-position_ (attributing the reason to whichever miss was deepest) **under-reports**: the
  depth-first search reaches deep positions early, while the budget is healthy, so a genuine miss
  recorded there masks a give-up that happens later while backtracking through shallower ones. The
  user is told a confident "no song is titled X" for a search that quietly stopped looking.
- _`searchesUsed >= maxSearches`_ **over-reports**: it is equally true of a search that finished
  exhaustively and merely happened to spend its last search doing so.

Both failure modes are pinned by tests. **No `index` field was added.** An earlier draft carried
the stuck word's position so the UI could point at a repeated word ("the … the") precisely; the UI
does not do that, so the field would have been a wire widening with no consumer (CLAUDE.md §7,
YAGNI) on a contract this repo has already flagged as fragile. The word itself is quoted in the
copy, which is unambiguous enough.

`reason` is additive on the `SentenceMatchResult`/`PreviewEvent` shape ADR 0013 locked — the same
category as Iteration 6's `index`/`wordCount`/`searches`/`tokens` widenings, not a new wire
format. The NDJSON contract is now guarded by a compile-time `expectTypeOf` assertion
(`src/lib/preview-stream.contract.test.ts`) checked by `pnpm typecheck`, closing the follow-up the
roadmap had open since Iteration 6 Chunk 1.

## Alternatives considered

- **Deepen every candidate, any word count.** Rejected — measured, not assumed: a live probe found
  zero benefit for multi-word phrases, so deepening them would only add a real search per
  multi-word miss (potentially doubling worst-case cost on long sentences) for nothing.
- **`track:"…"` field-filtered search instead of a second page.** Rejected — measured worse: fewer
  results per page and the exact titles needed never surfaced even 1000 results deep.
- **Fuzzy/similarity matching.** Rejected — relitigates ADR 0003's locked exact-match rule for a
  problem (recall, not match quality) it wouldn't have fixed anyway.
- **An LLM to interpret/reword the sentence or pick tracks.** Rejected — no evidence the matcher
  was failing to understand anything; every failure traced to page-1 recall. Revisit only if a
  future failure mode is genuinely about ambiguity, not recall.
- **Raise `maxSearches` instead of deepening selectively.** Rejected as the primary fix — it would
  let more multi-word misses burn real searches without benefit (per the probe) while doing
  nothing for the actual cause; deepening only bare words fixes the reported problem directly and
  cheaply.

## Consequences

- Sentences with ordinary articles ("a," "the," "I") now resolve instead of dead-ending — verified
  live: "I am eating a quesadilla for lunch today" (the exact sentence reported broken) now
  produces a full playlist.
- Search cost per request can go either up or down: bare-word misses that used to trigger deep
  backtracking (trying every shorter grouping, then giving up) now often resolve in one extra page
  fetch instead — one live-verified sentence dropped from 22 to 17 total searches while also
  yielding a cleaner match ("Jumps" instead of "Fox Jumps (To the Rave)"). Multi-word phrases are
  unaffected (no deepening attempted).
- A budget give-up is now told apart from a genuine no-match, so the app never advises rewording a
  word when it simply stopped looking. Note the guarantee is about the _reason_, not the word: the
  word named on a `"budget"` result is still the deepest one the search actually got stuck on, but
  the sentence may well have been coverable by groupings the search never reached.
- **Deepening changes what the budget buys.** A 1-word lookup that misses now costs 2 searches, so
  the same 100-search ceiling funds fewer distinct lookups on tiny-word-heavy sentences. Left at
  100 deliberately: bare words now usually _hit_ (removing whole backtracking subtrees), and the
  net went **down** on the sentence measured (22 → 17). If real sentences start hitting the
  ceiling, the `"budget"` reason now makes that visible instead of silently mislabelling it —
  raise `maxSearches` then, with evidence.
- `unmatched` on `SentenceMatchResult`/the terminal event is now always a **single-element** array
  (or empty only for a blank sentence) rather than a list of every failed grouping — a narrowing of
  its _content_, not its type, so existing consumers typed against `string[]` are unaffected.
