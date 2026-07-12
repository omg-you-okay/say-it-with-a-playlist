"use client";

import { useEffect, useRef, type FormEvent, type KeyboardEvent } from "react";

import type { LogKind, LogLine } from "@/lib/live-search";

// The black box: the machine. Black means exactly one thing in this design —
// live machinery — which is why the white canvas has no status bar at all.
//
// It has two modes. *Input*: you type, and the footer reads "↵ spell it out".
// On submit it becomes the *logger*: the sentence freezes into a readout (it is
// no longer a control, so it renders as text rather than as a disabled input —
// a disabled field would be unfocusable and unread), and the footer becomes the
// expand toggle. Expanded, it takes the whole rail.

// ADR 0003 caps the playlist name at 100 characters, and the name *is* the
// sentence — so this is the code's limit surfaced, not an invented one.
export const SENTENCE_MAX = 100;

// How far from the bottom the user must scroll before we stop following the
// log. This has to clear a whole row (a `try`/`hit` line plus its detail line
// is ~34px) — comparing against a smaller gap than one row means the very first
// row that overflows leaves the list "not at the bottom", and it never follows
// again. Stick, not force: someone who scrolls up to read is left alone.
const UNSTICK_THRESHOLD_PX = 48;

const KIND_COLOR: Record<LogKind, string> = {
  tokenise: "text-console-muted",
  try: "text-console-muted",
  hit: "text-hit-console",
  miss: "text-miss-console",
  split: "text-split-console",
  done: "text-console-foreground",
};

function LogView({ log, className }: { log: LogLine[]; className?: string }) {
  const listRef = useRef<HTMLOListElement>(null);
  // Whether the log is still following the newest line. Driven by real scroll
  // events rather than re-measured after each append: once new content has been
  // added, the distance to the bottom already includes it, so measuring then
  // cannot tell "the user scrolled away" apart from "a row just arrived".
  const following = useRef(true);

  function handleScroll(event: React.UIEvent<HTMLOListElement>) {
    const list = event.currentTarget;
    following.current =
      list.scrollHeight - list.scrollTop - list.clientHeight <
      UNSTICK_THRESHOLD_PX;
  }

  useEffect(() => {
    const list = listRef.current;
    if (!list || !following.current) return;
    list.scrollTop = list.scrollHeight;
  }, [log]);

  return (
    <ol
      ref={listRef}
      onScroll={handleScroll}
      role="log"
      // Deliberately off: a long sentence emits hundreds of events, and a
      // polite live region would read every `try` and `miss` aloud. The footer
      // carries a live status line instead, announcing only the transitions
      // that matter. The log stays here, navigable, for anyone who wants it.
      aria-live="off"
      className={`scroll-slim-dark flex flex-col gap-2 overflow-y-auto px-4 py-3 text-xs ${className ?? ""}`}
    >
      {/* Not virtualized and deliberately not `content-visibility: auto`: with
          estimated off-screen heights the container's scrollHeight is only
          approximate, so following the log lands short of the last line. The
          list is capped at MAX_LOG_LINES short rows — laying them all out is
          cheaper than getting the scroll wrong. */}
      {log.map((line) => (
        <li key={line.id} className="flex gap-3">
          {/* Fixed column: the design's 52px clipped "tokenise" to "token". */}
          <span
            className={`w-[62px] shrink-0 ${KIND_COLOR[line.kind]}`}
            aria-hidden
          >
            {line.kind}
          </span>
          <span className="min-w-0 flex-1">
            <span className="sr-only">{line.kind}: </span>
            <span className="block break-words text-console-foreground">
              {line.message}
            </span>
            {line.detail && (
              <span className="block break-words text-console-dim">
                {line.detail}
              </span>
            )}
          </span>
        </li>
      ))}
    </ol>
  );
}

function Caret() {
  return (
    <span aria-hidden className="shrink-0 text-console-dim">
      ›
    </span>
  );
}

export function ConsoleBox({
  mode,
  sentence,
  onSentenceChange,
  onSubmit,
  log,
  expanded,
  onToggleExpanded,
  onNewSentence,
  status,
  busy,
}: {
  mode: "input" | "logger";
  sentence: string;
  onSentenceChange: (sentence: string) => void;
  onSubmit: () => void;
  log: LogLine[];
  expanded: boolean;
  onToggleExpanded: () => void;
  onNewSentence: () => void;
  /** Coarse phase text — the one thing announced to screen readers. */
  status: string;
  busy: boolean;
}) {
  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (sentence.trim() === "" || busy) return;
    onSubmit();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSubmit(event);
    }
  }

  return (
    <section
      // w-full, not just flex-1: the wrapper is a flex column, so without an
      // explicit width this box would shrink to its content instead of filling
      // the rail.
      className={`flex w-full min-w-0 flex-col overflow-hidden rounded-lg bg-console ${
        expanded ? "min-h-0 flex-1" : ""
      }`}
      aria-label="Search console"
    >
      {mode === "input" ? (
        <form onSubmit={handleSubmit} className="flex flex-1 flex-col">
          <div className="flex flex-1 gap-2 px-4 pt-4 pb-2">
            <Caret />
            <label htmlFor="sentence" className="sr-only">
              Your sentence
            </label>
            <textarea
              id="sentence"
              value={sentence}
              onChange={(event) => onSentenceChange(event.target.value)}
              onKeyDown={handleKeyDown}
              maxLength={SENTENCE_MAX}
              rows={3}
              autoComplete="off"
              placeholder="Enter your text…"
              className="min-h-[4.5rem] w-full resize-none bg-transparent text-console-foreground placeholder:text-console-dim focus-visible:outline-none"
            />
          </div>

          <div className="flex items-center justify-between border-t border-console-border px-4 py-2.5 text-xs">
            <span className="text-console-dim tabular-nums">
              {sentence.length} / {SENTENCE_MAX}
            </span>
            <button
              type="submit"
              disabled={sentence.trim() === "" || busy}
              className="rounded px-1 text-console-foreground transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-console-muted focus-visible:outline-none disabled:opacity-40"
            >
              <span aria-hidden className="mr-1.5 text-console-dim">
                ↵
              </span>
              spell it out
            </button>
          </div>
        </form>
      ) : (
        <>
          {/* Collapsed, the frozen sentence sits above the log as the readout.
              Expanded, the canvas strip already shows it, so the rail gives all
              its height to the log instead (frame D3). */}
          {!expanded && (
            <p className="flex gap-2 px-4 pt-4 pb-3 text-console-foreground">
              <Caret />
              <span className="min-w-0 break-words">{sentence}</span>
            </p>
          )}

          <div className="flex shrink-0 items-center justify-between border-y border-console-border px-4 py-2 text-xs">
            <span className="tracking-[0.14em] text-console-dim uppercase">
              Log
            </span>
            <span className="text-console-dim tabular-nums">
              {log.length} event{log.length === 1 ? "" : "s"}
            </span>
          </div>

          <LogView
            log={log}
            className={expanded ? "min-h-0 flex-1" : "max-h-40"}
          />

          <div className="mt-auto flex shrink-0 items-center justify-between border-t border-console-border px-4 py-2.5 text-xs">
            {busy ? (
              <span aria-live="polite" className="text-console-dim">
                {status}
              </span>
            ) : (
              <button
                type="button"
                onClick={onNewSentence}
                className="rounded px-1 text-console-muted transition-opacity hover:text-console-foreground focus-visible:ring-2 focus-visible:ring-console-muted focus-visible:outline-none"
              >
                <span aria-hidden className="mr-1.5 text-console-dim">
                  ‹
                </span>
                new sentence
              </button>
            )}

            <button
              type="button"
              onClick={onToggleExpanded}
              aria-expanded={expanded}
              className="rounded px-1 text-console-foreground transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-console-muted focus-visible:outline-none"
            >
              <span aria-hidden className="mr-1.5 text-console-dim">
                {expanded ? "▾" : "▴"}
              </span>
              {expanded ? "hide log" : "show log"}
            </button>
          </div>

          {/* The only thing announced: phase transitions, not every event. */}
          {!busy && (
            <p aria-live="polite" className="sr-only">
              {status}
            </p>
          )}
        </>
      )}
    </section>
  );
}
