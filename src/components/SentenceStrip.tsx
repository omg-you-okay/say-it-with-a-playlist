import type { CurrentTry, ResolvedTrack } from "@/lib/live-search";
import { carveSentence } from "@/lib/live-search";

// The sentence, carved by the grouping the matcher is currently committed to.
// Placed phrases read green; the phrase being tried right now is inverted (the
// one place on the white canvas that borrows the console's black, because it
// *is* the machine's cursor); words not yet reached stay muted.
//
// This is the second view onto the same positional state the track list shows
// — when the loop backtracks, both must un-place together or the page starts
// lying about what the answer is.

function Divider() {
  return (
    <span aria-hidden className="mx-1.5 text-muted-foreground/60">
      /
    </span>
  );
}

export function SentenceStrip({
  tokens,
  placed,
  trying,
}: {
  tokens: string[];
  placed: ResolvedTrack[];
  trying: CurrentTry | null;
}) {
  const carved = carveSentence(tokens, placed, trying);

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">
        Your sentence
      </h2>

      {/* The whole strip reads as one sentence to a screen reader; the
          per-phrase colouring is decoration on top of that. */}
      <p className="flex flex-wrap items-center text-lg leading-relaxed">
        {carved.placed.map((item, i) => (
          <span key={item.index} className="flex items-center">
            {i > 0 && <Divider />}
            <span className="text-hit">{item.phrase}</span>
          </span>
        ))}

        {carved.trying && (
          <span className="flex items-center">
            {carved.placed.length > 0 && <Divider />}
            <span className="rounded bg-foreground px-2 py-0.5 text-background motion-safe:animate-in motion-safe:fade-in">
              {carved.trying.phrase}
            </span>
          </span>
        )}

        {carved.rest.length > 0 && (
          <span className="flex items-center">
            {(carved.placed.length > 0 || carved.trying) && <Divider />}
            <span className="text-muted-foreground">
              {carved.rest.join(" ")}
            </span>
          </span>
        )}
      </p>
    </section>
  );
}
