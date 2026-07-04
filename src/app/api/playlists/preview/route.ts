import { NextResponse, type NextRequest } from "next/server";

import { MissingTokensError } from "@/server/identity/managers/UserManager";
import { createPlaylistManager } from "@/server/playlist/managers/PlaylistManager";
import { readSessionToken, SESSION_COOKIE } from "@/server/shared/session";

// POST /api/playlists/preview — the decompose-and-match step of the Iteration
// 4 preview-then-create flow (ADR 0012): matches the sentence to real Spotify
// tracks but creates nothing. The frontend shows the result and lets the user
// confirm before POSTing the same tracks to /api/playlists/create.

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

  try {
    const result = await createPlaylistManager().previewSentence(
      userId,
      sentence,
    );
    if (!result.ok) {
      return NextResponse.json(
        { unmatched: result.unmatched },
        { status: 422 },
      );
    }
    return NextResponse.json({ tracks: result.tracks });
  } catch (error) {
    if (error instanceof MissingTokensError) {
      return NextResponse.json({ error: "login_required" }, { status: 401 });
    }
    console.error("Playlist preview failed", error);
    return NextResponse.json({ error: "preview_failed" }, { status: 500 });
  }
}
