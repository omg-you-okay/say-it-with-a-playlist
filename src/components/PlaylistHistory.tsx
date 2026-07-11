// Server-rendered history list (Iteration 5) — no client interactivity
// beyond a native <details> disclosure and plain links, so this stays a
// server component: it just renders the props the homepage passed it.

interface HistoryTrack {
  phrase: string;
  trackName: string;
  artistNames: string[];
}

export interface HistoryEntry {
  id: string;
  sentence: string;
  url: string;
  tracks: HistoryTrack[];
  createdAt: Date;
}

const DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

export function PlaylistHistory({ entries }: { entries: HistoryEntry[] }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-outfit text-sm font-medium text-muted-foreground">
        Your past playlists
      </h2>

      {entries.length === 0 ? (
        <p className="font-outfit text-sm text-muted-foreground">
          Nothing here yet — generate a playlist above and it&apos;ll show up
          here.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {entries.map((entry) => (
            <li
              key={entry.id}
              className="rounded-md border border-border bg-background/50 px-3 py-2 font-outfit text-sm"
            >
              <div className="flex items-start justify-between gap-4">
                <a
                  href={entry.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline underline-offset-4"
                >
                  {entry.sentence}
                </a>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {DATE_FORMATTER.format(entry.createdAt)}
                </span>
              </div>

              <details className="mt-1">
                <summary className="cursor-pointer text-xs text-muted-foreground">
                  {entry.tracks.length} track
                  {entry.tracks.length === 1 ? "" : "s"}
                </summary>
                <ol className="mt-1 flex flex-col gap-1">
                  {entry.tracks.map((track, i) => (
                    <li key={i}>
                      <span className="text-muted-foreground">
                        &ldquo;{track.phrase}&rdquo; →{" "}
                      </span>
                      {track.trackName}
                      {track.artistNames.length > 0 &&
                        ` — ${track.artistNames.join(", ")}`}
                    </li>
                  ))}
                </ol>
              </details>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
