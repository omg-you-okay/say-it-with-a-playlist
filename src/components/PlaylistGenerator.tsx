"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

// Local mirror of the wire shape returned by /api/playlists/preview and
// echoed to /api/playlists/create (ADR 0012) — the UI layer stays ignorant
// of server-side types, same separation as PlaylistResource's own
// storage-shape type (ADR 0008).
interface TrackCandidate {
  id: string;
  uri: string;
  name: string;
  artistNames: string[];
}

interface MatchedTrack {
  phrase: string;
  track: TrackCandidate;
}

type Phase =
  | { step: "input" }
  | { step: "previewing" }
  | { step: "previewed"; tracks: MatchedTrack[] }
  | { step: "unmatched"; unmatched: string[] }
  | { step: "creating"; tracks: MatchedTrack[] }
  | { step: "created"; url: string }
  | { step: "error"; message: string };

const GENERIC_ERROR = "Something went wrong. Please try again.";
const LOGIN_REQUIRED_ERROR = "Your session expired — please log in again.";

export function PlaylistGenerator() {
  const router = useRouter();
  const [sentence, setSentence] = useState("");
  const [isPublic, setIsPublic] = useState(false);
  const [phase, setPhase] = useState<Phase>({ step: "input" });

  const busy = phase.step === "previewing" || phase.step === "creating";

  async function handlePreview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!sentence.trim() || busy) return;

    setPhase({ step: "previewing" });
    try {
      const res = await fetch("/api/playlists/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sentence }),
      });
      const body = await res.json();
      if (res.status === 200) {
        setPhase({ step: "previewed", tracks: body.tracks });
      } else if (res.status === 422) {
        setPhase({ step: "unmatched", unmatched: body.unmatched });
      } else if (res.status === 401) {
        setPhase({ step: "error", message: LOGIN_REQUIRED_ERROR });
      } else {
        setPhase({ step: "error", message: GENERIC_ERROR });
      }
    } catch {
      setPhase({ step: "error", message: GENERIC_ERROR });
    }
  }

  async function handleCreate(tracks: MatchedTrack[]) {
    setPhase({ step: "creating", tracks });
    try {
      const res = await fetch("/api/playlists/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sentence, tracks, public: isPublic }),
      });
      const body = await res.json();
      if (res.status === 200) {
        setPhase({ step: "created", url: body.url });
        // The homepage is a server component reading history at render time
        // (Iteration 5) — refresh so the new playlist shows up without a
        // full reload (same idiom as LogoutButton).
        router.refresh();
      } else if (res.status === 401) {
        setPhase({ step: "error", message: LOGIN_REQUIRED_ERROR });
      } else {
        setPhase({ step: "error", message: GENERIC_ERROR });
      }
    } catch {
      setPhase({ step: "error", message: GENERIC_ERROR });
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={handlePreview} className="flex flex-col gap-2">
        <Label htmlFor="sentence" className="font-outfit">
          Your sentence
        </Label>
        <div className="flex gap-2">
          <Input
            id="sentence"
            value={sentence}
            onChange={(event) => setSentence(event.target.value)}
            placeholder="I will always love you"
            disabled={busy}
            className="font-outfit"
          />
          <Button
            type="submit"
            size="sm"
            variant="default"
            className="shrink-0 font-outfit"
            disabled={busy || !sentence.trim()}
          >
            {phase.step === "previewing" ? "Matching…" : "Preview"}
          </Button>
        </div>
      </form>

      {phase.step === "unmatched" && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <p className="mb-1 font-medium">
            Couldn&apos;t find tracks for the whole sentence.
          </p>
          <p>Try rewording: {phase.unmatched.join(", ")}</p>
        </div>
      )}

      {phase.step === "error" && (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {phase.message}
        </p>
      )}

      {(phase.step === "previewed" || phase.step === "creating") && (
        <div className="flex flex-col gap-3 rounded-md border border-border bg-background/50 px-3 py-3">
          <ol className="flex flex-col gap-1 font-outfit text-sm">
            {phase.tracks.map((matched, i) => (
              <li key={`${matched.track.id}-${i}`}>
                <span className="text-muted-foreground">
                  &ldquo;{matched.phrase}&rdquo; →{" "}
                </span>
                {matched.track.name}
                {matched.track.artistNames.length > 0 &&
                  ` — ${matched.track.artistNames.join(", ")}`}
              </li>
            ))}
          </ol>

          <div className="flex items-center gap-2">
            <Switch
              id="visibility"
              checked={isPublic}
              onCheckedChange={setIsPublic}
              disabled={phase.step === "creating"}
            />
            <Label htmlFor="visibility" className="font-outfit">
              {isPublic ? "Public" : "Private"} playlist
            </Label>
          </div>

          <Button
            size="sm"
            variant="default"
            className="w-fit font-outfit"
            disabled={phase.step === "creating"}
            onClick={() => handleCreate(phase.tracks)}
          >
            {phase.step === "creating" ? "Creating…" : "Create playlist"}
          </Button>
        </div>
      )}

      {phase.step === "created" && (
        <div className="flex flex-col items-start gap-2 rounded-md border border-border bg-background/50 px-3 py-3 font-outfit text-sm">
          <p>Your playlist is ready.</p>
          <a
            href={phase.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline underline-offset-4"
          >
            Open on Spotify
          </a>
          <Button
            size="sm"
            variant="outline"
            className="w-fit font-outfit"
            onClick={() => setPhase({ step: "input" })}
          >
            Make another
          </Button>
        </div>
      )}
    </div>
  );
}
