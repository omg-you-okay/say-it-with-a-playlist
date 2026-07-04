import { cookies } from "next/headers";

import { LogoutButton } from "@/components/LogoutButton";
import { PlaylistGenerator } from "@/components/PlaylistGenerator";
import { Button } from "@/components/ui/button";
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

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-6">
      <div className="w-full max-w-md rounded-md border border-red-700/30 bg-sidebar-accent px-6 py-5 drop-shadow-2xl drop-shadow-gray-300">
        <div className="mb-2 flex items-start justify-between gap-4">
          <h1 className="font-blackletter text-4xl tracking-tight text-red-700">
            Say It With a Playlist
          </h1>
          {userId && <LogoutButton />}
        </div>

        <p className="text-md mb-8 text-left font-outfit font-light">
          Type a sentence and get a real Spotify playlist whose track titles —
          read in order — spell it out.
        </p>

        {authError && (
          <p className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {authError}
          </p>
        )}

        {userId ? (
          <PlaylistGenerator />
        ) : (
          // Plain <a>, not next/link: this route 307s cross-origin to Spotify's
          // OAuth screen, and Link's client-side fetch hits a CORS wall on that
          // redirect before falling back — a full navigation skips it entirely.
          <Button asChild size="sm" variant="default" className="font-outfit">
            <a href="/api/auth/login">Log in with Spotify</a>
          </Button>
        )}
      </div>
    </main>
  );
}
