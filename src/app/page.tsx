import { cookies } from "next/headers";

import type { HistoryEntry } from "@/components/HistoryRail";
import { PlaylistWorkspace } from "@/components/PlaylistWorkspace";
import { createUserManager } from "@/server/identity/managers/UserManager";
import { createPlaylistManager } from "@/server/playlist/managers/PlaylistManager";
import { readSessionToken, SESSION_COOKIE } from "@/server/shared/session";

// Known callback failure codes (see api/auth/callback/route.ts) mapped to
// copy a user can act on. Anything unrecognized falls back to a generic
// message rather than surfacing a raw error code.
const AUTH_ERROR_MESSAGES: Record<string, string> = {
  access_denied: "Login was cancelled — you can try again anytime.",
  invalid_request: "Spotify rejected the login request. Please try again.",
  invalid_scope:
    "Spotify rejected the requested permissions. Please try again.",
  unauthorized_client:
    "This app isn't authorized with Spotify yet. Please try again later.",
  unsupported_response_type:
    "Spotify rejected the login request. Please try again.",
  server_error: "Spotify had a problem on their end. Please try again.",
  temporarily_unavailable:
    "Spotify is temporarily unavailable. Please try again shortly.",
  spotify_error: "Something went wrong with Spotify login. Please try again.",
  missing_params: "The login link was incomplete. Please try logging in again.",
  state_mismatch: "Your login attempt expired. Please try logging in again.",
  callback_failed: "Something went wrong finishing login. Please try again.",
};

// Formatted here, on the server, rather than in the client tree: an Intl call
// during hydration can format against a different timezone than the server
// render used, and React would flag the mismatch.
const DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
});

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ auth_error?: string }>;
}) {
  const [cookieStore, params] = await Promise.all([cookies(), searchParams]);
  const userId = await readSessionToken(cookieStore.get(SESSION_COOKIE)?.value);
  const authError = params.auth_error
    ? (AUTH_ERROR_MESSAGES[params.auth_error] ??
      AUTH_ERROR_MESSAGES.callback_failed)
    : undefined;

  if (!userId) {
    return <LoggedOut authError={authError} />;
  }

  // Two independent reads, both hitting only Postgres — no reason to await them
  // one after the other. Neither is worth failing the page over: history
  // degrades to a soft message, and a missing profile falls back to a generic
  // name in the rail.
  const [historyResult, profileResult] = await Promise.allSettled([
    createPlaylistManager().getHistory(userId),
    createUserManager().getProfile(userId),
  ]);

  if (historyResult.status === "rejected") {
    console.error("Failed to load playlist history", historyResult.reason);
  }
  if (profileResult.status === "rejected") {
    console.error("Failed to load the user profile", profileResult.reason);
  }

  const historyError = historyResult.status === "rejected";
  const history: HistoryEntry[] =
    historyResult.status === "fulfilled"
      ? historyResult.value.map((entry) => ({
          id: entry.id,
          sentence: entry.sentence,
          url: entry.url,
          trackCount: entry.tracks.length,
          dateLabel: DATE_FORMATTER.format(entry.createdAt),
        }))
      : [];
  const displayName =
    profileResult.status === "fulfilled"
      ? (profileResult.value?.displayName ?? null)
      : null;

  return (
    <PlaylistWorkspace
      displayName={displayName}
      history={history}
      historyError={historyError}
    />
  );
}

function LoggedOut({ authError }: { authError?: string }) {
  return (
    <main id="main" className="flex flex-1 items-center justify-center p-4">
      <div className="flex w-full max-w-md flex-col gap-6 rounded-lg border border-border bg-card px-8 py-10">
        <h1 className="text-lg font-semibold tracking-[0.14em] uppercase">
          Say it with
          <br />a playlist
        </h1>

        <p className="text-muted-foreground">
          Type a sentence and get a real Spotify playlist whose track titles —
          read in order — spell it out.
        </p>

        {authError && (
          <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {authError}
          </p>
        )}

        {/* A plain <a>, not next/link: this route 307s cross-origin to
            Spotify's OAuth screen, and Link's client-side fetch hits a CORS
            wall on that redirect before falling back to a real navigation. */}
        <a
          href="/api/auth/login"
          className="w-fit rounded-full bg-spotify px-5 py-2.5 text-sm font-semibold tracking-wide text-black transition-opacity hover:opacity-90 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          LOG IN WITH SPOTIFY
        </a>
      </div>
    </main>
  );
}
