"use client";

import { LogoutButton } from "@/components/LogoutButton";

// The rail's identity + history block. Text-only by design: no album art
// anywhere in this app, which also means old history rows can never rot when a
// Spotify CDN URL expires.

export interface HistoryEntry {
  id: string;
  sentence: string;
  url: string;
  trackCount: number;
  /** Formatted on the server — an Intl call here would risk a timezone-driven
      hydration mismatch between the server render and the browser's. */
  dateLabel: string;
}

export function UserChip({ displayName }: { displayName: string | null }) {
  const name = displayName?.trim() || "Spotify user";
  const initial = name.charAt(0).toUpperCase();

  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5">
      <span
        aria-hidden
        className="flex size-6 shrink-0 items-center justify-center rounded-full bg-foreground text-xs font-medium text-background"
      >
        {initial}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm" title={name}>
        {name}
      </span>
      <LogoutButton />
    </div>
  );
}

const HEADING = "text-xs font-medium tracking-[0.14em] uppercase";

/**
 * On the rail (desktop) history is simply a list. On a phone the rail collapses
 * — there is no room for a standing list above a docked console — so the same
 * content hides behind a disclosure the user opens deliberately.
 */
export function HistoryRail({
  entries,
  open,
  onToggle,
}: {
  entries: HistoryEntry[];
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <section className="flex min-h-0 flex-col gap-2">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls="history-list"
        className="flex shrink-0 items-baseline justify-between gap-2 rounded px-1 text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none lg:hidden"
      >
        <span className={HEADING}>History</span>
        <span className="flex items-baseline gap-2 text-xs tabular-nums">
          {entries.length}
          <span aria-hidden>{open ? "▾" : "▴"}</span>
        </span>
      </button>

      <div className="hidden shrink-0 items-baseline justify-between px-1 lg:flex">
        <h2 className={`${HEADING} text-muted-foreground`}>History</h2>
        <span className="text-xs text-muted-foreground tabular-nums">
          {entries.length}
        </span>
      </div>

      {entries.length === 0 ? (
        <p
          id="history-list"
          className={`px-1 text-xs text-muted-foreground ${open ? "" : "hidden lg:block"}`}
        >
          Nothing yet. Spell something out and it&apos;ll show up here.
        </p>
      ) : (
        <ul
          id="history-list"
          className={`scroll-slim min-h-0 flex-col gap-2 overflow-y-auto ${open ? "flex" : "hidden lg:flex"}`}
        >
          {entries.map((entry) => (
            <li key={entry.id}>
              <a
                href={entry.url}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex flex-col gap-1 rounded-lg border border-border bg-card px-3 py-2.5 transition-colors hover:border-foreground/25 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                <span className="flex items-start justify-between gap-2">
                  <span className="min-w-0 text-sm break-words">
                    {entry.sentence}
                  </span>
                  <span
                    aria-hidden
                    className="shrink-0 text-muted-foreground transition-colors group-hover:text-foreground"
                  >
                    ↗
                  </span>
                </span>
                <span className="text-xs text-muted-foreground">
                  {entry.trackCount} track{entry.trackCount === 1 ? "" : "s"}
                  {" · "}
                  {entry.dateLabel}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
