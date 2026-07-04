import { NextResponse, type NextRequest } from "next/server";

import { MissingTokensError } from "@/server/identity/managers/UserManager";
import {
  createPlaylistManager,
  type MatchedTrack,
} from "@/server/playlist/managers/PlaylistManager";
import { readSessionToken, SESSION_COOKIE } from "@/server/shared/session";

// POST /api/playlists/create — the create step of the Iteration 4
// preview-then-create flow (ADR 0012): builds the playlist from the tracks
// the client already confirmed via /api/playlists/preview, at the chosen
// visibility. Does not re-run the match — the confirmed list is the source
// of truth for what gets added.

function isTrackCandidate(value: unknown): value is MatchedTrack["track"] {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.uri === "string" &&
    typeof candidate.name === "string" &&
    Array.isArray(candidate.artistNames) &&
    candidate.artistNames.every((name) => typeof name === "string")
  );
}

function isMatchedTrack(value: unknown): value is MatchedTrack {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.phrase === "string" && isTrackCandidate(candidate.track)
  );
}

export async function POST(request: NextRequest) {
  const userId = await readSessionToken(
    request.cookies.get(SESSION_COOKIE)?.value,
  );
  if (!userId) {
    return NextResponse.json({ error: "login_required" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const {
    sentence,
    tracks,
    public: isPublic,
  } = (body ?? {}) as Record<string, unknown>;
  if (typeof sentence !== "string" || sentence.trim() === "") {
    return NextResponse.json({ error: "missing_sentence" }, { status: 400 });
  }
  if (
    !Array.isArray(tracks) ||
    tracks.length === 0 ||
    !tracks.every(isMatchedTrack)
  ) {
    return NextResponse.json({ error: "missing_tracks" }, { status: 400 });
  }
  if (typeof isPublic !== "boolean") {
    return NextResponse.json({ error: "missing_visibility" }, { status: 400 });
  }

  try {
    const result = await createPlaylistManager().createFromTracks(
      userId,
      sentence,
      tracks,
      isPublic,
    );
    return NextResponse.json({ url: result.url });
  } catch (error) {
    if (error instanceof MissingTokensError) {
      return NextResponse.json({ error: "login_required" }, { status: 401 });
    }
    console.error("Playlist creation failed", error);
    return NextResponse.json({ error: "create_failed" }, { status: 500 });
  }
}
