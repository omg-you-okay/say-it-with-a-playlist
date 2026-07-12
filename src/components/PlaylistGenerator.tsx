"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  readPreviewEvents,
  type MatchedTrack,
  type TrackCandidate,
} from "@/lib/preview-stream";

// The live search view (ADR 0013): as NDJSON progress events arrive, we keep
// a positional map of resolved tracks (by word index) and a running log.
// `hit` places a track at its index; a `try` at index i *prunes* everything
// resolved at or after i, because the loop only re-attempts a position it is
// re-deciding — so anything it had resolved from there on is no longer part
// of the answer. Pruning on `try` rather than on `split` matters: the loop
// emits no `split` when the abandoned candidate was the last (1-word) one at
// that position, which would otherwise strand a track on screen that the
// search has already backtracked out of. This keeps the live list honest with
// what the loop is doing rather than replaying a result that already finished.

interface ResolvedTrack {
  index: number;
  phrase: string;
  track: TrackCandidate;
}

interface LogLine {
  id: number;
  text: string;
  kind: "try" | "hit" | "miss" | "split";
}

type Phase =
  | { step: "input" }
  | {
      step: "searching";
      currentPhrase: string | null;
      resolved: ResolvedTrack[];
      log: LogLine[];
    }
  | { step: "previewed"; tracks: MatchedTrack[] }
  | { step: "unmatched"; unmatched: string[] }
  | { step: "creating"; tracks: MatchedTrack[] }
  | { step: "created"; url: string }
  | { step: "error"; message: string };

const GENERIC_ERROR = "Something went wrong. Please try again.";
const LOGIN_REQUIRED_ERROR = "Your session expired — please log in again.";

// How close to the bottom the log must already be for a new line to re-pin it.
const STICK_TO_BOTTOM_PX = 24;

export function PlaylistGenerator() {
  const router = useRouter();
  const [sentence, setSentence] = useState("");
  const [isPublic, setIsPublic] = useState(false);
  const [phase, setPhase] = useState<Phase>({ step: "input" });
  const logRef = useRef<HTMLOListElement>(null);

  const busy = phase.step === "searching" || phase.step === "creating";

  // Stick the log to its latest line as events stream in — otherwise the box
  // stays scrolled where it first rendered and the "watch it happen live"
  // view silently falls behind the header's current phrase. Stick, not force:
  // if the user has scrolled up to read, events arrive fast enough that
  // re-pinning every time would yank the log out from under them.
  useEffect(() => {
    const log = logRef.current;
    if (phase.step !== "searching" || !log) return;
    const distanceFromBottom =
      log.scrollHeight - log.scrollTop - log.clientHeight;
    if (distanceFromBottom < STICK_TO_BOTTOM_PX) {
      log.scrollTop = log.scrollHeight;
    }
  }, [phase]);

  async function handlePreview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!sentence.trim() || busy) return;

    setPhase({ step: "searching", currentPhrase: null, resolved: [], log: [] });

    let logId = 0;
    const resolvedByIndex = new Map<number, ResolvedTrack>();

    try {
      const res = await fetch("/api/playlists/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sentence }),
      });

      if (res.status === 401) {
        setPhase({ step: "error", message: LOGIN_REQUIRED_ERROR });
        return;
      }
      if (res.status !== 200 || !res.body) {
        setPhase({ step: "error", message: GENERIC_ERROR });
        return;
      }

      for await (const evt of readPreviewEvents(res.body)) {
        switch (evt.type) {
          case "tokenised":
            break;

          case "try": {
            // Re-attempting this position means everything the loop had
            // resolved from here on has been backtracked out of the answer.
            for (const key of [...resolvedByIndex.keys()]) {
              if (key >= evt.index) resolvedByIndex.delete(key);
            }
            const resolved = [...resolvedByIndex.values()].sort(
              (a, b) => a.index - b.index,
            );
            logId += 1;
            const line: LogLine = {
              id: logId,
              text: `trying "${evt.phrase}"`,
              kind: "try",
            };
            setPhase((prev) =>
              prev.step === "searching"
                ? {
                    ...prev,
                    currentPhrase: evt.phrase,
                    resolved,
                    log: [...prev.log, line],
                  }
                : prev,
            );
            break;
          }

          case "hit": {
            resolvedByIndex.set(evt.index, {
              index: evt.index,
              phrase: evt.phrase,
              track: evt.track,
            });
            const resolved = [...resolvedByIndex.values()].sort(
              (a, b) => a.index - b.index,
            );
            logId += 1;
            const line: LogLine = {
              id: logId,
              text: `"${evt.phrase}" → ${evt.track.name}`,
              kind: "hit",
            };
            setPhase((prev) =>
              prev.step === "searching"
                ? { ...prev, resolved, log: [...prev.log, line] }
                : prev,
            );
            break;
          }

          case "miss": {
            logId += 1;
            const line: LogLine = {
              id: logId,
              text: `no match for "${evt.phrase}"`,
              kind: "miss",
            };
            setPhase((prev) =>
              prev.step === "searching"
                ? { ...prev, log: [...prev.log, line] }
                : prev,
            );
            break;
          }

          case "split": {
            // Narrative only — the prune happens on the `try` that follows.
            logId += 1;
            const line: LogLine = {
              id: logId,
              text: `breaking "${evt.phrase}" into shorter spans`,
              kind: "split",
            };
            setPhase((prev) =>
              prev.step === "searching"
                ? { ...prev, log: [...prev.log, line] }
                : prev,
            );
            break;
          }

          case "done":
            if (evt.ok) {
              setPhase({ step: "previewed", tracks: evt.tracks });
            } else {
              setPhase({ step: "unmatched", unmatched: evt.unmatched });
            }
            return;

          case "error":
            setPhase({
              step: "error",
              message:
                evt.code === "login_required"
                  ? LOGIN_REQUIRED_ERROR
                  : GENERIC_ERROR,
            });
            return;
        }
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
            {phase.step === "searching" ? "Matching…" : "Preview"}
          </Button>
        </div>
      </form>

      {phase.step === "searching" && (
        <div className="flex flex-col gap-3 rounded-md border border-border bg-background/50 px-3 py-3">
          {phase.currentPhrase && (
            <p className="font-outfit text-sm text-muted-foreground">
              Trying &ldquo;{phase.currentPhrase}&rdquo;…
            </p>
          )}

          {phase.resolved.length > 0 && (
            <ol className="flex flex-col gap-1 font-outfit text-sm">
              {phase.resolved.map((resolved) => (
                <li key={resolved.index}>
                  <span className="text-muted-foreground">
                    &ldquo;{resolved.phrase}&rdquo; →{" "}
                  </span>
                  {resolved.track.name}
                </li>
              ))}
            </ol>
          )}

          <ol
            ref={logRef}
            className="flex max-h-40 flex-col gap-0.5 overflow-y-auto font-outfit text-xs text-muted-foreground"
          >
            {phase.log.map((line) => (
              <li
                key={line.id}
                className={
                  line.kind === "hit"
                    ? "text-foreground"
                    : line.kind === "miss"
                      ? "text-destructive"
                      : undefined
                }
              >
                {line.text}
              </li>
            ))}
          </ol>
        </div>
      )}

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
