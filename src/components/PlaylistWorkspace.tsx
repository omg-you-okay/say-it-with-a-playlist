"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { ConsoleBox } from "@/components/ConsoleBox";
import {
  HistoryRail,
  UserChip,
  type HistoryEntry,
} from "@/components/HistoryRail";
import { PlaylistPanel, type PanelRow } from "@/components/PlaylistPanel";
import { SentenceStrip } from "@/components/SentenceStrip";
import type { CurrentTry, LogLine, ResolvedTrack } from "@/lib/live-search";
import {
  readPreviewEvents,
  type MatchedTrack,
  type PreviewEvent,
} from "@/lib/preview-stream";

// The workspace owns the live-search state machine (ADR 0013) and renders it
// into both columns: the console that drives it lives in the rail, the sentence
// strip and playlist it produces live on the canvas. That split across columns
// is why this is one component rather than two — they are two views of one
// state, and they must never disagree about what the matcher has decided.

type Phase =
  | { step: "input" }
  | { step: "searching" }
  | { step: "previewed"; tracks: MatchedTrack[] }
  | { step: "unmatched"; unmatched: string[] }
  | { step: "creating"; tracks: MatchedTrack[] }
  | { step: "created"; tracks: MatchedTrack[]; url: string }
  | { step: "error"; message: string };

/** What the loop is doing right now — the strip and the track list read this. */
interface LiveState {
  tokens: string[];
  placed: ResolvedTrack[];
  trying: CurrentTry | null;
}

const EMPTY_LIVE: LiveState = { tokens: [], placed: [], trying: null };

const GENERIC_ERROR = "Something went wrong. Please try again.";
const LOGIN_REQUIRED_ERROR = "Your session expired — please log in again.";

// A long sentence at the maxSearches budget can emit several hundred events.
// The log box is fixed-height by design, so retaining every line buys nothing
// and costs a growing copy on each render.
const MAX_LOG_LINES = 200;

const FALLBACK_EXAMPLES = [
  "i will always love you",
  "sorry i am late again",
  "happy birthday you legend",
];

export function PlaylistWorkspace({
  displayName,
  history,
  historyError,
}: {
  displayName: string | null;
  history: HistoryEntry[];
  historyError: boolean;
}) {
  const router = useRouter();
  const [sentence, setSentence] = useState("");
  const [isPublic, setIsPublic] = useState(false);
  const [phase, setPhase] = useState<Phase>({ step: "input" });
  const [live, setLive] = useState<LiveState>(EMPTY_LIVE);
  const [log, setLog] = useState<LogLine[]>([]);
  const [logExpanded, setLogExpanded] = useState(false);
  // Mobile only — on the rail the list is always shown (see HistoryRail).
  const [historyOpen, setHistoryOpen] = useState(false);

  // Events arrive one per await, so a setState per event is a render per event
  // — and each one copied the whole log array (O(n²) over a few hundred
  // events). Instead the stream writes into refs and a single animation frame
  // publishes whatever accumulated, collapsing a burst into one render.
  const liveRef = useRef<LiveState>(EMPTY_LIVE);
  const placedByIndex = useRef(new Map<number, ResolvedTrack>());
  const pendingLog = useRef<LogLine[]>([]);
  const frame = useRef<number | null>(null);
  const logId = useRef(0);
  const startedAt = useRef(0);

  const flush = useCallback(() => {
    frame.current = null;
    setLive(liveRef.current);
    if (pendingLog.current.length > 0) {
      const batch = pendingLog.current;
      pendingLog.current = [];
      setLog((prev) => [...prev, ...batch].slice(-MAX_LOG_LINES));
    }
  }, []);

  const schedule = useCallback(() => {
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(flush);
  }, [flush]);

  useEffect(() => {
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, []);

  function pushLog(line: Omit<LogLine, "id">) {
    logId.current += 1;
    pendingLog.current.push({ ...line, id: logId.current });
  }

  function publishNow() {
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
    }
    flush();
  }

  function applyEvent(event: PreviewEvent) {
    switch (event.type) {
      case "tokenised":
        liveRef.current = { ...liveRef.current, tokens: event.tokens };
        pushLog({
          kind: "tokenise",
          message: `${event.words} word${event.words === 1 ? "" : "s"}`,
        });
        break;

      case "try": {
        // Re-attempting a position means everything the loop had resolved from
        // here on has been backtracked out of the answer. Prune on `try` and
        // not on `split`: the loop emits no `split` when the abandoned
        // candidate was the last (1-word) one at that position, which would
        // otherwise strand a track on screen that the search already undid.
        for (const key of [...placedByIndex.current.keys()]) {
          if (key >= event.index) placedByIndex.current.delete(key);
        }
        liveRef.current = {
          ...liveRef.current,
          placed: sortedPlaced(),
          trying: {
            index: event.index,
            phrase: event.phrase,
            words: event.words,
          },
        };
        pushLog({
          kind: "try",
          message: `“${event.phrase}”`,
          detail: `${event.words} word${event.words === 1 ? "" : "s"}`,
        });
        break;
      }

      case "hit":
        placedByIndex.current.set(event.index, {
          index: event.index,
          wordCount: event.wordCount,
          phrase: event.phrase,
          track: event.track,
        });
        liveRef.current = {
          ...liveRef.current,
          placed: sortedPlaced(),
          trying: null,
        };
        pushLog({
          kind: "hit",
          message: event.track.name,
          detail: event.track.artistNames.join(", ") || undefined,
        });
        break;

      case "miss":
        pushLog({ kind: "miss", message: "no exact title" });
        break;

      case "split":
        pushLog({
          kind: "split",
          message: `“${event.phrase}” → shorter spans`,
        });
        break;

      case "done": {
        const seconds = ((Date.now() - startedAt.current) / 1000).toFixed(1);
        const cost = `${event.searches} search${
          event.searches === 1 ? "" : "es"
        } · ${seconds}s`;

        if (event.ok) {
          const words = liveRef.current.tokens.length;
          pushLog({
            kind: "done",
            message: `${words}/${words} words placed · ${event.tracks.length} track${
              event.tracks.length === 1 ? "" : "s"
            }`,
            detail: cost,
          });
          liveRef.current = { ...liveRef.current, trying: null };
          publishNow();
          setPhase({ step: "previewed", tracks: event.tracks });
        } else {
          pushLog({
            kind: "done",
            message: "couldn't cover the whole sentence",
            detail: cost,
          });
          liveRef.current = { ...liveRef.current, trying: null };
          publishNow();
          setPhase({ step: "unmatched", unmatched: event.unmatched });
        }
        break;
      }

      case "error":
        // Clear `trying` for the same reason `done` does: the strip renders in
        // every non-input phase, so leaving the last attempt set would strand an
        // inverted "currently searching" chip on screen after the search died.
        liveRef.current = { ...liveRef.current, trying: null };
        publishNow();
        setPhase({
          step: "error",
          message:
            event.code === "login_required"
              ? LOGIN_REQUIRED_ERROR
              : GENERIC_ERROR,
        });
        break;
    }
  }

  function sortedPlaced(): ResolvedTrack[] {
    return [...placedByIndex.current.values()].sort(
      (a, b) => a.index - b.index,
    );
  }

  async function handlePreview() {
    if (!sentence.trim()) return;

    placedByIndex.current.clear();
    pendingLog.current = [];
    logId.current = 0;
    liveRef.current = EMPTY_LIVE;
    startedAt.current = Date.now();
    setLog([]);
    setLive(EMPTY_LIVE);
    setPhase({ step: "searching" });

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

      for await (const event of readPreviewEvents(res.body)) {
        applyEvent(event);
        if (event.type === "done" || event.type === "error") return;
        schedule();
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
      // A 200 with no url would otherwise render a PLAY ON SPOTIFY link with
      // href="undefined" — a dead button that looks like a working one.
      if (res.status === 200 && typeof body?.url === "string") {
        setPhase({ step: "created", tracks, url: body.url });
        // The page is a Server Component that reads history at render time —
        // refresh so the new playlist appears without a reload.
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

  function handleNewSentence() {
    setPhase({ step: "input" });
    setLive(EMPTY_LIVE);
    setLog([]);
    setLogExpanded(false);
    setSentence("");
  }

  const busy = phase.step === "searching" || phase.step === "creating";

  const status =
    phase.step === "searching"
      ? "searching…"
      : phase.step === "previewed"
        ? `Found ${phase.tracks.length} tracks. Ready to create.`
        : phase.step === "created"
          ? "Playlist created."
          : phase.step === "unmatched"
            ? "Couldn't cover the whole sentence."
            : phase.step === "error"
              ? phase.message
              : "";

  const examples = history.length
    ? history.slice(0, 3).map((entry) => entry.sentence)
    : FALLBACK_EXAMPLES;

  return (
    // Mobile stacks: rail header on top, canvas under it, console docked to the
    // bottom of the viewport (see the console wrapper below) — hence the deep
    // bottom padding, which reserves the space the docked console floats over.
    //
    // Desktop pins the whole workspace to the viewport. Without a *definite*
    // height here, `flex-1` on the expanded console has no ceiling to resolve
    // against, so instead of scrolling inside its box the log just grows the
    // page. `lg:flex-none` matters as much as `lg:h-dvh`: this div is itself a
    // flex child of <body>, and `flex-1` (basis 0% + grow) would otherwise win
    // over the height on the main axis and let it grow anyway. Everything that
    // scrolls — the log, the track list, history — does it inside its own box,
    // so the page itself never needs to.
    <div className="flex min-h-0 flex-1 flex-col gap-4 p-4 pb-72 lg:h-dvh lg:flex-none lg:flex-row lg:overflow-hidden lg:pb-4">
      {/* The canvas: the artifact. No status bar — black is reserved for the
          machine, and the machine lives in the rail. */}
      <main
        id="main"
        className="scroll-slim order-2 flex min-h-96 flex-1 items-center justify-center rounded-lg border border-border bg-card px-6 py-10 lg:order-1 lg:min-h-0 lg:overflow-y-auto"
      >
        <div className="w-full max-w-xl">
          {phase.step === "input" ? (
            <div className="flex flex-col gap-4">
              <h2 className="text-2xl font-semibold text-balance">
                Nothing to spell yet.
              </h2>
              <p className="text-muted-foreground">
                Type a sentence in the console, or start from one of these.
              </p>
              <ul className="flex flex-wrap gap-2">
                {examples.map((example) => (
                  <li key={example}>
                    <button
                      type="button"
                      onClick={() => setSentence(example.slice(0, 100))}
                      className="rounded-md border border-border bg-card px-3 py-2 text-sm transition-colors hover:border-foreground/25 hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                    >
                      {example}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="flex flex-col gap-8">
              <SentenceStrip
                tokens={live.tokens}
                placed={live.placed}
                trying={live.trying}
              />

              {phase.step === "error" ? (
                <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                  {phase.message}
                </p>
              ) : phase.step === "unmatched" ? (
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
                  <p className="mb-1 font-medium text-destructive">
                    Couldn&apos;t find tracks for the whole sentence.
                  </p>
                  <p className="text-muted-foreground">
                    Try rewording: {phase.unmatched.join(", ")}
                  </p>
                </div>
              ) : (
                <PlaylistPanel
                  rows={panelRows(phase, live)}
                  total={phase.step === "searching" ? null : trackCount(phase)}
                  footer={
                    phase.step === "previewed" || phase.step === "creating"
                      ? {
                          kind: "create",
                          isPublic,
                          onVisibilityChange: setIsPublic,
                          onCreate: () => handleCreate(phase.tracks),
                          busy: phase.step === "creating",
                        }
                      : phase.step === "created"
                        ? { kind: "created", isPublic, url: phase.url }
                        : { kind: "none" }
                  }
                />
              )}
            </div>
          )}
        </div>
      </main>

      {/* The rail: identity, history, and the machine. */}
      <aside className="order-1 flex min-h-0 shrink-0 flex-col gap-4 lg:order-2 lg:w-[360px]">
        <div className="shrink-0 px-1">
          <h1 className="text-sm font-semibold tracking-[0.14em] uppercase">
            Say it with
            <br />a playlist
          </h1>
        </div>

        <UserChip displayName={displayName} />

        {/* Expanded, the log takes the rail (frame D3) — history steps aside. */}
        {!logExpanded &&
          (historyError ? (
            <p className="px-1 text-xs text-muted-foreground">
              Couldn&apos;t load your past playlists.
            </p>
          ) : (
            <HistoryRail
              entries={history}
              open={historyOpen}
              onToggle={() => setHistoryOpen((open) => !open)}
            />
          ))}

        {/* One console, repositioned rather than duplicated: in the rail on
            desktop (pushed down by mt-auto), docked to the viewport bottom on a
            phone. Expanded, it takes the whole screen there — the mobile
            equivalent of taking the rail. */}
        <div
          className={`fixed inset-x-0 bottom-0 z-20 flex flex-col border-t border-border bg-background p-3 lg:static lg:z-auto lg:mt-auto lg:border-0 lg:bg-transparent lg:p-0 ${
            logExpanded ? "top-0 lg:top-auto lg:min-h-0 lg:flex-1" : ""
          }`}
        >
          <ConsoleBox
            mode={phase.step === "input" ? "input" : "logger"}
            sentence={sentence}
            onSentenceChange={setSentence}
            onSubmit={handlePreview}
            log={log}
            expanded={logExpanded}
            onToggleExpanded={() => setLogExpanded((open) => !open)}
            onNewSentence={handleNewSentence}
            status={status}
            busy={busy}
          />
        </div>

        <p className="shrink-0 px-1 text-xs text-muted-foreground">
          Content from Spotify
        </p>
      </aside>
    </div>
  );
}

function trackCount(phase: Phase): number | null {
  if (
    phase.step === "previewed" ||
    phase.step === "creating" ||
    phase.step === "created"
  ) {
    return phase.tracks.length;
  }
  return null;
}

/**
 * While searching, the list is the live positional state — the tracks placed so
 * far plus a pending row for the phrase being tried. Once done, it is simply
 * the answer.
 */
function panelRows(phase: Phase, live: LiveState): PanelRow[] {
  if (
    phase.step === "previewed" ||
    phase.step === "creating" ||
    phase.step === "created"
  ) {
    return phase.tracks.map((matched, i) => ({
      key: `${matched.track.id}-${i}`,
      phrase: matched.phrase,
      title: matched.track.name,
      artist: matched.track.artistNames.join(", ") || null,
    }));
  }

  const rows: PanelRow[] = live.placed.map((item) => ({
    key: `placed-${item.index}`,
    phrase: item.phrase,
    title: item.track.name,
    artist: item.track.artistNames.join(", ") || null,
  }));

  if (live.trying) {
    rows.push({
      key: `trying-${live.trying.index}`,
      phrase: live.trying.phrase,
      title: null,
      artist: null,
    });
  }

  return rows;
}
