import { test as base, type Page } from "@playwright/test";

import { createSessionToken, SESSION_COOKIE } from "@/server/shared/session";

import { E2E_USER_ID } from "./session";

// A logged-in page, plus a way to drive the preview stream without Spotify.
//
// The seam: the server route (`/api/playlists/preview`) already has integration
// tests, and the parts of it we cannot reach from a browser — the Spotify search,
// the backtracking loop — are unit-tested to death. What *nothing* covered until
// now is everything downstream of `fetch()` returning: the NDJSON reader, the
// React state machine it feeds, and the layout that renders the result. That is
// exactly where Iteration 6's five bugs lived. So these tests stub the response
// and exercise the client for real.

export interface PreviewStub {
  /** Serve this event sequence as a real, progressively-chunked NDJSON stream. */
  streamPreview(events: unknown[], opts?: { delayMs?: number }): Promise<void>;
}

export const test = base.extend<{ loggedIn: Page; preview: PreviewStub }>({
  loggedIn: async ({ page, baseURL }, use) => {
    const token = await createSessionToken(E2E_USER_ID);
    await page.context().addCookies([
      {
        name: SESSION_COOKIE,
        value: token,
        url: baseURL!,
      },
    ]);
    await use(page);
  },

  preview: async ({ page }, use) => {
    await use({
      async streamPreview(events, { delayMs = 60 } = {}) {
        // Why patch `fetch` rather than use `page.route`: Playwright's
        // `route.fulfill` delivers the body in a single chunk. The client would
        // then parse every event in one pass and React would batch the lot into
        // one render — so the test would pass even if the live progress view were
        // completely broken, which is the one thing it exists to check. Patching
        // fetch inside the page lets us hand the app a genuine ReadableStream and
        // enqueue events over time, exactly as the server does.
        await page.addInitScript(
          ({ events, delayMs }) => {
            const original = window.fetch;
            window.fetch = async (input, init) => {
              const url =
                typeof input === "string"
                  ? input
                  : input instanceof URL
                    ? input.href
                    : input.url;
              if (!url.includes("/api/playlists/preview")) {
                return original(input, init);
              }
              const stream = new ReadableStream<Uint8Array>({
                async start(controller) {
                  const encoder = new TextEncoder();
                  for (const event of events) {
                    await new Promise((r) => setTimeout(r, delayMs));
                    controller.enqueue(
                      encoder.encode(`${JSON.stringify(event)}\n`),
                    );
                  }
                  controller.close();
                },
              });
              return new Response(stream, {
                status: 200,
                headers: { "Content-Type": "application/x-ndjson" },
              });
            };
          },
          { events, delayMs },
        );
      },
    });
  },
});

export { expect } from "@playwright/test";

/** A track shaped like SpotifyResource's TrackCandidate. */
export function track(id: string, name: string) {
  return {
    id,
    uri: `spotify:track:${id}`,
    name,
    artistNames: ["Test Artist"],
  };
}

/**
 * The happy path for "red blue": two words, each matched to a track. Mirrors the
 * NDJSON contract in ADR 0013/0015 — `tokenised` first, `try`/`hit` per phrase,
 * and a terminal `done` carrying the authoritative track list.
 */
export function successfulRun() {
  const tracks = [
    { phrase: "red", track: track("t1", "Red") },
    { phrase: "blue", track: track("t2", "Blue") },
  ];
  return [
    { type: "tokenised", words: 2, tokens: ["red", "blue"] },
    { type: "try", index: 0, phrase: "red blue", words: 2 },
    { type: "miss", index: 0, phrase: "red blue" },
    { type: "split", index: 0, phrase: "red blue" },
    { type: "try", index: 0, phrase: "red", words: 1 },
    {
      type: "hit",
      index: 0,
      phrase: "red",
      wordCount: 1,
      track: track("t1", "Red"),
    },
    { type: "try", index: 1, phrase: "blue", words: 1 },
    {
      type: "hit",
      index: 1,
      phrase: "blue",
      wordCount: 1,
      track: track("t2", "Blue"),
    },
    { type: "done", searches: 3, ok: true, tracks },
  ];
}
