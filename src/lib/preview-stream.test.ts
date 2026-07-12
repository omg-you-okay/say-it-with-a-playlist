import { describe, expect, it } from "vitest";

import { readPreviewEvents, type PreviewEvent } from "./preview-stream";

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function collect(
  body: ReadableStream<Uint8Array>,
): Promise<PreviewEvent[]> {
  const events: PreviewEvent[] = [];
  for await (const event of readPreviewEvents(body)) events.push(event);
  return events;
}

describe("readPreviewEvents", () => {
  it("yields each event when a chunk holds several whole lines", async () => {
    const events = await collect(
      streamOf([
        '{"type":"tokenised","words":1}\n{"type":"try","index":0,"phrase":"hello","words":1}\n',
      ]),
    );

    expect(events).toEqual([
      { type: "tokenised", words: 1 },
      { type: "try", index: 0, phrase: "hello", words: 1 },
    ]);
  });

  it("reassembles a JSON object split across chunk boundaries", async () => {
    const line = '{"type":"tokenised","words":1}\n';
    const splitPoint = 15;
    const events = await collect(
      streamOf([line.slice(0, splitPoint), line.slice(splitPoint)]),
    );

    expect(events).toEqual([{ type: "tokenised", words: 1 }]);
  });

  it("yields a trailing line with no final newline", async () => {
    const events = await collect(streamOf(['{"type":"tokenised","words":2}']));

    expect(events).toEqual([{ type: "tokenised", words: 2 }]);
  });

  it("propagates a JSON.parse failure for a malformed line", async () => {
    await expect(collect(streamOf(["not json\n"]))).rejects.toThrow();
  });
});
