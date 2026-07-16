import { expect, successfulRun, test } from "./fixtures";

// The live search view, driven in a real browser (ADR 0018).
//
// The state machine underneath is already unit-tested to death in
// `PlaylistWorkspace.test.tsx` (jsdom): backtracking, pruning, the footer swap,
// the honest failure copy. Repeating that here would buy nothing. What jsdom
// *cannot* see — because it has no layout engine — is the class of bug that hurt
// most in Iteration 6: an element that escapes its scroll container, a page that
// grows sideways, a log that stretches the document instead of scrolling inside
// its box. Every one of those shipped past a green unit suite and was caught only
// by measuring a real browser. These tests measure a real browser.
//
// No Spotify, no OAuth: the session cookie is minted from the app's own signing
// key (`e2e/session.ts`) and the preview stream is stubbed at `fetch`
// (`e2e/fixtures.ts`), so the whole view is drivable in CI — which was the
// original blocker on this suite (roadmap Iteration 5 → "Deferred → CI e2e").

/** The horizontal overflow of the document, in px. > 0 means the page scrolls
 *  sideways — the exact width-dependent failure Iteration 6 shipped repeatedly. */
async function horizontalOverflow(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const el = document.documentElement;
    return el.scrollWidth - el.clientWidth;
  });
}

/** A long, incoherent-but-well-typed run whose only job is to emit enough log
 *  lines to overflow the console. Placement doesn't matter here — the log
 *  appends one line per event regardless — so this stays deliberately simple. */
function longRun(): unknown[] {
  const events: unknown[] = [
    { type: "tokenised", words: 4, tokens: ["one", "two", "three", "four"] },
  ];
  for (let i = 0; i < 40; i++) {
    events.push({ type: "try", index: i % 4, phrase: `phrase ${i}`, words: 1 });
    events.push({ type: "miss", index: i % 4, phrase: `phrase ${i}` });
  }
  events.push({
    type: "done",
    searches: 40,
    ok: false,
    unmatched: ["four"],
    reason: "no_match",
  });
  return events;
}

test.describe("live search — real-browser layout", () => {
  test("carves the sentence into tracks without the page scrolling sideways", async ({
    loggedIn: page,
    preview,
  }) => {
    await preview.streamPreview(successfulRun());
    await page.goto("/");

    await page.getByLabel("Your sentence").fill("red blue");
    await page.getByRole("button", { name: /spell it out/i }).click();

    // The two matched tracks land in the playlist, in order. Scope to the list:
    // the titles also appear in the log's `hit` lines.
    const tracks = page.getByRole("list", { name: "Matched tracks" });
    await expect(tracks.getByText("Red", { exact: true })).toBeVisible();
    await expect(tracks.getByText("Blue", { exact: true })).toBeVisible();

    // The search settled: Create is the list's terminal action.
    await expect(
      page.getByRole("button", { name: "Create playlist" }),
    ).toBeVisible();

    // The whole point of the suite. Runs on desktop *and* the mobile project —
    // Iteration 6's overflow bugs (the nested-flex sentence strip, the
    // scrollbar-gutter white strip) were width-dependent, so mobile is a
    // first-class target here, not an afterthought. Allow 1px for rounding.
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
  });

  test("the expanded log scrolls inside its box, it does not grow the page", async ({
    loggedIn: page,
    preview,
  }, testInfo) => {
    // "The page stays pinned to the viewport" is a desktop invariant: the mobile
    // layout docks the console and scrolls the canvas by design. This is the
    // regression guard for Iteration 6 layout bug #1 (the expanded log grew the
    // page because `lg:flex-none` was missing) and the `sr-only` phantom-scroll
    // bug (an unanchored absolute span escaped the log and stretched the doc).
    test.skip(
      testInfo.project.name !== "desktop",
      "viewport-pinned layout is desktop-only; mobile scrolls by design",
    );

    await preview.streamPreview(longRun(), { delayMs: 4 });
    await page.goto("/");

    await page.getByLabel("Your sentence").fill("one two three four");
    await page.getByRole("button", { name: /spell it out/i }).click();

    // Wait for the run to finish (the failure copy proves the terminal `done`
    // landed and the log is fully populated).
    await expect(page.getByText(/No song is titled/)).toBeVisible();

    await page.getByRole("button", { name: /show log/i }).click();
    const log = page.getByRole("log");
    await expect(log).toBeVisible();

    const { pageScroll, logScrolls } = await page.evaluate(() => {
      const scroller = document.scrollingElement!;
      const logEl = document.querySelector('[role="log"]')!;
      return {
        pageScroll: scroller.scrollHeight - scroller.clientHeight,
        logScrolls: logEl.scrollHeight - logEl.clientHeight,
      };
    });

    // The overflow lives inside the log, not on the document.
    expect(logScrolls).toBeGreaterThan(0);
    expect(pageScroll).toBeLessThanOrEqual(1);
    // And still no sideways growth, log expanded.
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
  });
});
