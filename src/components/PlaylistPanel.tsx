"use client";

// The playlist panel owns its own header and footer, and the rows scroll
// between them. Create and the visibility choice live in that footer because
// they are properties of *this list* — its terminal action and its mode — not
// homeless global controls. Pinning the footer is also what stops Create from
// drifting off-screen on a long sentence.

export interface PanelRow {
  key: string;
  phrase: string;
  /** The matched track title, or null while this position is still being searched. */
  title: string | null;
  artist: string | null;
}

type Footer =
  | { kind: "none" }
  | {
      kind: "create";
      isPublic: boolean;
      onVisibilityChange: (isPublic: boolean) => void;
      onCreate: () => void;
      busy: boolean;
    }
  | { kind: "created"; isPublic: boolean; url: string };

function VisibilityToggle({
  isPublic,
  onChange,
  disabled,
}: {
  isPublic: boolean;
  onChange: (isPublic: boolean) => void;
  disabled: boolean;
}) {
  return (
    <div
      role="group"
      aria-label="Playlist visibility"
      className="flex items-center gap-0.5 rounded-md bg-muted p-0.5"
    >
      {([false, true] as const).map((value) => {
        const selected = isPublic === value;
        const label = value ? "Public" : "Private";
        return (
          <button
            key={label}
            type="button"
            aria-pressed={selected}
            disabled={disabled}
            onClick={() => onChange(value)}
            className={`rounded px-3 py-1 text-sm transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 ${
              selected
                ? "bg-card text-foreground shadow-sm ring-1 ring-border"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

export function PlaylistPanel({
  rows,
  total,
  footer,
}: {
  rows: PanelRow[];
  /** Word-covering is still in progress, so the final count is unknown. */
  total: number | null;
  footer: Footer;
}) {
  const found = rows.filter((row) => row.title !== null).length;

  return (
    <section className="flex max-h-[60vh] flex-col overflow-hidden rounded-lg border border-border bg-card">
      <header className="flex shrink-0 items-center justify-between border-b border-border px-4 py-2.5">
        <h2 className="text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">
          Playlist
        </h2>
        <span className="text-xs text-muted-foreground tabular-nums">
          {total === null
            ? `${found} of ? tracks`
            : `${total} track${total === 1 ? "" : "s"}`}
        </span>
      </header>

      <ol
        aria-label="Matched tracks"
        className="scroll-slim min-h-0 flex-1 overflow-y-auto"
      >
        {rows.map((row, i) => {
          const searching = row.title === null;
          return (
            <li
              key={row.key}
              className={`flex items-center gap-4 border-b border-border px-4 py-3 last:border-b-0 ${
                searching ? "bg-muted" : ""
              }`}
            >
              <span className="w-6 shrink-0 text-sm text-muted-foreground tabular-nums">
                {String(i + 1).padStart(2, "0")}
              </span>

              <span className="min-w-0 flex-1">
                <span
                  className={`block truncate ${
                    searching
                      ? "text-muted-foreground"
                      : "font-medium text-foreground"
                  }`}
                  title={row.title ?? undefined}
                >
                  {row.title ?? "searching…"}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  &ldquo;{row.phrase}&rdquo;
                </span>
              </span>

              {/* Spotify's metadata guidelines size this column: artist names
                  get 18 characters before they may be truncated. */}
              <span
                className="hidden max-w-[18ch] shrink-0 truncate text-sm text-muted-foreground sm:block"
                title={row.artist ?? undefined}
              >
                {row.artist ?? "—"}
              </span>

              <span className="w-4 shrink-0 text-center" aria-hidden>
                {searching ? (
                  <span className="inline-block size-2 rounded-full bg-foreground motion-safe:animate-pulse" />
                ) : (
                  <span className="text-hit">✓</span>
                )}
              </span>
              <span className="sr-only">
                {searching ? "searching" : "matched"}
              </span>
            </li>
          );
        })}
      </ol>

      {footer.kind !== "none" && (
        <footer className="flex shrink-0 items-center justify-between gap-4 border-t border-border px-4 py-3">
          {footer.kind === "create" ? (
            <>
              <VisibilityToggle
                isPublic={footer.isPublic}
                onChange={footer.onVisibilityChange}
                disabled={footer.busy}
              />
              <button
                type="button"
                onClick={footer.onCreate}
                disabled={footer.busy}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/85 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
              >
                {footer.busy ? "Creating…" : "Create playlist"}
              </button>
            </>
          ) : (
            <>
              <span className="text-sm text-muted-foreground">
                {footer.isPublic ? "Public" : "Private"} playlist
              </span>
              {/* Spotify's design guidelines fix this copy: PLAY ON SPOTIFY is
                  one of their approved strings, and their green is reserved for
                  exactly this — a CTA back to Spotify, never a semantic colour
                  elsewhere in the UI. Black on the green, not white: white fails
                  contrast on #1ED760. */}
              <a
                href={footer.url}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-full bg-spotify px-4 py-2 text-sm font-semibold tracking-wide text-black transition-opacity hover:opacity-90 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                PLAY ON SPOTIFY
              </a>
            </>
          )}
        </footer>
      )}
    </section>
  );
}
