// UI-local mirror of the NDJSON events PlaylistManager / POST
// /api/playlists/preview emit (ADR 0013) — same separation PlaylistGenerator's
// existing TrackCandidate/MatchedTrack mirror follows (the ADR 0008 pattern):
// the UI layer stays ignorant of server-side types.

export interface TrackCandidate {
  id: string;
  uri: string;
  name: string;
  artistNames: string[];
}

export interface MatchedTrack {
  phrase: string;
  track: TrackCandidate;
}

export type PreviewEvent =
  | { type: "tokenised"; words: number }
  | { type: "try"; index: number; phrase: string; words: number }
  | {
      type: "hit";
      index: number;
      phrase: string;
      wordCount: number;
      track: TrackCandidate;
    }
  | { type: "miss"; index: number; phrase: string }
  | { type: "split"; index: number; phrase: string }
  | { type: "done"; ok: true; tracks: MatchedTrack[] }
  | { type: "done"; ok: false; unmatched: string[] }
  | { type: "error"; message: string; code?: string };

/**
 * Reads an NDJSON body (one JSON object per line) and yields each parsed
 * event in order. Buffers across chunk boundaries — a line can split
 * mid-object across two reads — and tolerates a final line with no trailing
 * newline.
 */
export async function* readPreviewEvents(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<PreviewEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        if (line.trim() !== "") yield JSON.parse(line) as PreviewEvent;
      }
    }
    buffer += decoder.decode();
    if (buffer.trim() !== "") yield JSON.parse(buffer) as PreviewEvent;
  } finally {
    // Consumers break out of the loop at the terminal event, so cancel rather
    // than just releasing the lock — otherwise the body is left un-torn-down.
    await reader.cancel();
  }
}
