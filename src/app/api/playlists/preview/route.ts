import { NextResponse, type NextRequest } from "next/server";

import {
  MissingTokensError,
  ReauthRequiredError,
} from "@/server/identity/managers/UserManager";
import {
  createPlaylistManager,
  type PreviewEvent,
} from "@/server/playlist/managers/PlaylistManager";
import { readSessionToken, SESSION_COOKIE } from "@/server/shared/session";

// POST /api/playlists/preview — the decompose-and-match step of the Iteration
// 4 preview-then-create flow (ADR 0012). Streams progress as NDJSON (ADR
// 0013): the Manager emits PreviewEvents through a callback as its
// backtracking loop runs, and this route adapts that callback into one JSON
// object per line. 401 (no session) and 400 (bad body) are decided before the
// stream opens and stay real status codes; everything after that — including
// ADR 0003's no-full-cover case and any mid-search failure — is a terminal
// event on the stream, because by the time the matcher knows, the response's
// 200 and headers are already on the wire.

type StreamEvent =
  | PreviewEvent
  | { type: "error"; message: string; code?: string };

export async function POST(request: NextRequest) {
  const userId = await readSessionToken(
    request.cookies.get(SESSION_COOKIE)?.value,
  );
  if (!userId) {
    return NextResponse.json({ error: "login_required" }, { status: 401 });
  }

  let sentence: unknown;
  try {
    ({ sentence } = await request.json());
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  if (typeof sentence !== "string" || sentence.trim() === "") {
    return NextResponse.json({ error: "missing_sentence" }, { status: 400 });
  }
  const validSentence = sentence;

  const encoder = new TextEncoder();
  // The Manager's loop keeps running after a client disconnects (ADR 0013
  // accepts this — maxSearches bounds it). Enqueueing onto a cancelled stream
  // throws, so once the client is gone we drop events on the floor instead:
  // without this, the first post-disconnect event throws out of the loop, the
  // catch below throws again trying to report it, and close() throws a third
  // time — turning an ordinary "user hit refresh" into an unhandled rejection.
  let open = true;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      function send(event: StreamEvent) {
        if (!open) return;
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      }
      try {
        await createPlaylistManager().previewSentence(
          userId,
          validSentence,
          send,
        );
      } catch (error) {
        // No tokens stored, or Spotify has rejected the grant outright (the app
        // was revoked). Both mean the same thing to the user, and the frontend
        // already renders `login_required` as a prompt to sign in again.
        if (
          error instanceof MissingTokensError ||
          error instanceof ReauthRequiredError
        ) {
          send({
            type: "error",
            message: "Your session expired — please log in again.",
            code: "login_required",
          });
        } else {
          console.error("Playlist preview failed", error);
          send({ type: "error", message: "preview_failed" });
        }
      } finally {
        if (open) controller.close();
      }
    },
    cancel() {
      open = false;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-store",
    },
  });
}
