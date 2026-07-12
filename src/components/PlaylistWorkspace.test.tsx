// @vitest-environment jsdom
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PreviewEvent } from "@/lib/preview-stream";

import { PlaylistWorkspace } from "./PlaylistWorkspace";

// The live view is the one place a bug is invisible to the eye: a happy-path
// click-through never backtracks, so a track the matcher has *un-placed* can
// sit on screen looking perfectly correct. These tests drive the NDJSON event
// stream directly and assert that both views onto the positional state — the
// sentence strip and the track list — un-place together (ADR 0013).

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => refresh() }),
}));

/** A preview stream the test feeds one event at a time, so it can assert on
 *  the UI mid-search rather than only on the finished result. */
function controlledPreview() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  return {
    stream,
    emit(event: PreviewEvent) {
      controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
    },
    close() {
      controller.close();
    },
  };
}

function track(id: string, name: string, artist: string) {
  return {
    id,
    uri: `spotify:track:${id}`,
    name,
    artistNames: [artist],
  };
}

let preview: ReturnType<typeof controlledPreview>;

beforeEach(() => {
  refresh.mockClear();
  preview = controlledPreview();

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (String(url).includes("/preview")) {
        // Only `status` and `body` are read; a full Response would drag in
        // environment differences for no gain.
        return { status: 200, body: preview.stream } as unknown as Response;
      }
      return {
        status: 200,
        json: async () => ({ url: "https://open.spotify.com/playlist/abc" }),
      } as unknown as Response;
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function startSearch(sentence: string) {
  const user = userEvent.setup();
  render(
    <PlaylistWorkspace displayName="Ada" history={[]} historyError={false} />,
  );
  await user.type(screen.getByLabelText("Your sentence"), sentence);
  await user.click(screen.getByRole("button", { name: /spell it out/i }));
  return user;
}

/** Track titles also appear in the log's `hit` lines, so assertions about what
 *  the *playlist* holds have to be scoped to the playlist. */
function trackList() {
  return within(screen.getByRole("list", { name: "Matched tracks" }));
}

describe("PlaylistWorkspace live search", () => {
  it("un-places a hit the matcher backtracks out of", async () => {
    await startSearch("red blue green");

    preview.emit({
      type: "tokenised",
      words: 3,
      tokens: ["red", "blue", "green"],
    });
    preview.emit({ type: "try", index: 0, phrase: "red blue", words: 2 });
    preview.emit({
      type: "hit",
      index: 0,
      phrase: "red blue",
      wordCount: 2,
      track: track("t1", "Red Blue", "The Reds"),
    });

    // The loop has committed to "red blue" — it is on screen.
    await waitFor(() =>
      expect(trackList().getByText("Red Blue")).toBeVisible(),
    );

    // "green" alone dead-ends, so the loop re-tries position 0 with a shorter
    // grouping. Note it emits NO split here: "green" was the last candidate at
    // its position. The `try` is the only signal that "red blue" is undone —
    // which is exactly why the client prunes on `try`.
    preview.emit({ type: "try", index: 2, phrase: "green", words: 1 });
    preview.emit({ type: "miss", index: 2, phrase: "green" });
    preview.emit({ type: "try", index: 0, phrase: "red", words: 1 });

    await waitFor(() =>
      expect(trackList().queryByText("Red Blue")).not.toBeInTheDocument(),
    );
    // ...and it is gone from the sentence strip too, not just the track list.
    // (The strip renders the bare phrase; the log renders it quoted, so this
    // query can only be matching the strip.)
    expect(screen.queryByText("red blue")).not.toBeInTheDocument();
  });

  it("shows the tracks it settles on, and the words it has not reached yet", async () => {
    await startSearch("red blue green");

    preview.emit({
      type: "tokenised",
      words: 3,
      tokens: ["red", "blue", "green"],
    });
    preview.emit({ type: "try", index: 0, phrase: "red", words: 1 });
    preview.emit({
      type: "hit",
      index: 0,
      phrase: "red",
      wordCount: 1,
      track: track("t2", "Red", "Taylor"),
    });
    preview.emit({ type: "try", index: 1, phrase: "blue green", words: 2 });

    await waitFor(() => expect(trackList().getByText("Red")).toBeVisible());
    // The row for the phrase being searched right now is pending, not matched.
    expect(trackList().getByText("searching…")).toBeVisible();
    // The strip shows the phrase currently being tried.
    expect(screen.getByText("blue green")).toBeVisible();
  });

  it("swaps the footer to PLAY ON SPOTIFY once the playlist is created", async () => {
    const user = await startSearch("red");

    preview.emit({ type: "tokenised", words: 1, tokens: ["red"] });
    preview.emit({ type: "try", index: 0, phrase: "red", words: 1 });
    preview.emit({
      type: "hit",
      index: 0,
      phrase: "red",
      wordCount: 1,
      track: track("t3", "Red", "Taylor"),
    });
    preview.emit({
      type: "done",
      searches: 1,
      ok: true,
      tracks: [{ phrase: "red", track: track("t3", "Red", "Taylor") }],
    });
    preview.close();

    const create = await screen.findByRole("button", {
      name: "Create playlist",
    });
    expect(
      screen.getByRole("group", { name: "Playlist visibility" }),
    ).toBeVisible();

    await user.click(create);

    const link = await screen.findByRole("link", { name: "PLAY ON SPOTIFY" });
    expect(link).toHaveAttribute(
      "href",
      "https://open.spotify.com/playlist/abc",
    );
    // Create is the list's terminal action — it is gone once it has happened.
    expect(
      screen.queryByRole("button", { name: "Create playlist" }),
    ).not.toBeInTheDocument();
    // The homepage re-reads history on the server, so the new row appears.
    expect(refresh).toHaveBeenCalled();
  });

  it("reports the real search cost on the terminal log line", async () => {
    await startSearch("red");

    preview.emit({ type: "tokenised", words: 1, tokens: ["red"] });
    preview.emit({ type: "try", index: 0, phrase: "red", words: 1 });
    preview.emit({
      type: "hit",
      index: 0,
      phrase: "red",
      wordCount: 1,
      track: track("t4", "Red", "Taylor"),
    });
    preview.emit({
      type: "done",
      searches: 6,
      ok: true,
      tracks: [{ phrase: "red", track: track("t4", "Red", "Taylor") }],
    });
    preview.close();

    // The count comes from the Manager, not from counting `try` events —
    // there were 1 try and 6 searches here, and the log must say 6.
    expect(await screen.findByText(/6 searches ·/)).toBeVisible();
  });

  it("names the single stuck word rather than listing every grouping tried (ADR 0015)", async () => {
    await startSearch("i am eating a quesadilla");

    preview.emit({
      type: "tokenised",
      words: 5,
      tokens: ["i", "am", "eating", "a", "quesadilla"],
    });
    preview.emit({
      type: "done",
      searches: 20,
      ok: false,
      unmatched: ["a"],
      reason: "no_match",
    });
    preview.close();

    expect(
      await screen.findByText(
        /No song is titled “a” — try rewording that word\./,
      ),
    ).toBeVisible();
  });

  it("names a budget give-up honestly instead of blaming an unsearched word (ADR 0015)", async () => {
    await startSearch("a very long sentence");

    preview.emit({
      type: "tokenised",
      words: 4,
      tokens: ["a", "very", "long", "sentence"],
    });
    preview.emit({
      type: "done",
      searches: 100,
      ok: false,
      unmatched: ["a"],
      reason: "budget",
    });
    preview.close();

    expect(
      await screen.findByText(
        "Gave up after 100 searches — try a shorter or simpler sentence.",
      ),
    ).toBeVisible();
  });
});
