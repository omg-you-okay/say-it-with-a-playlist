import { Fragment } from "react";

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
//
// Everything below is plain *inline* content: one run of text that wraps like
// a sentence. An earlier version wrapped each phrase in a flex item, which made
// the dividers unable to flow with the words and stranded the untried tail on
// its own line.

function Divider() {
  return (
    <span aria-hidden className="mx-2 text-muted-foreground/50">
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
  const hasLead = carved.placed.length > 0 || carved.trying !== null;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">
        Your sentence
      </h2>

      {/* leading-loose buys the inverted chip room for its padding without it
          colliding with the line above. */}
      <p className="text-lg leading-loose">
        {carved.placed.map((item, i) => (
          <Fragment key={item.index}>
            {i > 0 && <Divider />}
            <span className="text-hit">{item.phrase}</span>
          </Fragment>
        ))}

        {carved.trying && (
          <>
            {carved.placed.length > 0 && <Divider />}
            <span className="rounded bg-foreground px-2 py-1 text-background motion-safe:animate-in motion-safe:fade-in">
              {carved.trying.phrase}
            </span>
          </>
        )}

        {carved.rest.length > 0 && (
          <>
            {hasLead && <Divider />}
            <span className="text-muted-foreground">
              {carved.rest.join(" ")}
            </span>
          </>
        )}
      </p>
    </section>
  );
}
