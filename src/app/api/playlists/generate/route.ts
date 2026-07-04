import { NextResponse, type NextRequest } from "next/server";

import { MissingTokensError } from "@/server/identity/managers/UserManager";
import { createPlaylistManager } from "@/server/playlist/managers/PlaylistManager";
import { readSessionToken, SESSION_COOKIE } from "@/server/shared/session";

// POST /api/playlists/generate — the end-to-end use case (brief §2 steps
// 3-7): sentence in, decomposition, playlist created on the user's Spotify
// account, link + tracks out, history recorded. No-match sentences report
// the unmatched phrases and create nothing (ADR 0003).

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
    const result = await createPlaylistManager().generatePlaylist(
      userId,
      sentence,
    );
    if (!result.ok) {
      return NextResponse.json(
        { unmatched: result.unmatched },
        { status: 422 },
      );
    }
    return NextResponse.json({ url: result.url, tracks: result.tracks });
  } catch (error) {
    if (error instanceof MissingTokensError) {
      return NextResponse.json({ error: "login_required" }, { status: 401 });
    }
    console.error("Playlist generation failed", error);
    return NextResponse.json({ error: "generate_failed" }, { status: 500 });
  }
}
