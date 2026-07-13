# 0014 — UI components are bespoke Tailwind; shadcn stays as a generator

Date: 2026-07-12 · Status: accepted · **Amends [ADR 0001](0001-stack-nextjs-supabase-shadcn.md)**
(which names "shadcn/ui + Tailwind for UI components"). Tailwind, the lint-enforced layer
boundaries, and every other part of ADR 0001 are unchanged.

## Context

The Iteration 6 v3 design (frames in Figma, indexed in roadmap Iteration 6 → Design) specifies
controls that are not variants of the shadcn primitives — they are different controls:

- a **pill CTA** carrying Spotify's mandated `PLAY ON SPOTIFY` copy and their green,
- a **segmented Private/Public toggle**, not a `Switch`,
- **text-only buttons on the console's black surface**, where shadcn's `ghost` hover/border
  tokens are all light-surface,
- a **native `<textarea>`** with a character counter, not an `Input`.

By the end of Iteration 6 Chunk 2, nothing imported `components/ui/{button,input,label,switch}`.
They were dead files. Keeping them would have meant four unused components that a future session
might "helpfully" reintroduce, fighting the design.

## Decision

- **The four shadcn primitives are deleted.** UI components are hand-written Tailwind, composed
  against the Radix Colors token layer in `globals.css`.
- **shadcn remains wired** — the `shadcn` dependency and `components.json` stay — so
  `pnpm dlx shadcn add <component>` still works if a future screen wants a primitive (a dialog, a
  dropdown) that is genuinely worth not hand-rolling. shadcn is a **generator we can reach for**,
  not a library the design depends on.
- **Tailwind remains the styling system** and the `ui` → `manager` lint boundary is untouched.

## Alternatives considered

- **Keep the primitives and restyle them.** Rejected: the v3 controls are structurally different,
  not restyled variants. Forcing the segmented toggle through `Switch`, or the console's buttons
  through `ghost`, means overriding most of each `cva` base — more code than writing the control,
  and harder to read.
- **Keep them as dead files, unused.** Rejected: dead code with no consumer is a trap. It reads as
  "the sanctioned way to build a button here", which is no longer true.
- **Drop the `shadcn` dep and `components.json` too.** Rejected as premature: the CLI costs nothing
  while unused, and a future dialog/dropdown/popover is exactly where an accessible, well-tested
  primitive earns its keep. Removing it would make that a bigger decision than it needs to be.

## Consequences

- **ADR 0001's "shadcn/ui + Tailwind for UI components" no longer describes the code.** It is
  amended, not overturned: the stack is still Next.js + Tailwind, and shadcn is still installed.
- Anything genuinely primitive that a future screen needs (focus-trapped dialog, menu, popover)
  should come from `shadcn add` rather than being hand-rolled — hand-rolling accessible overlay
  primitives is where this decision would stop paying.
- Accessibility is now **our** responsibility on every control we write, not inherited from Radix.
  Iteration 6 Chunk 2 already paid part of that bill: the bespoke controls needed explicit focus
  rings, `aria-pressed` on the segmented toggle, an `aria-label`ed track list, a skip link, and a
  live-region strategy for the log. The `web-design-guidelines` skill run against the code is the
  standing check.
- Reversible, and cheap to reverse: `pnpm dlx shadcn add button input label switch` restores them.

## Amendment (2026-07-13, Iteration 8) — the leftovers this ADR missed

Deleting the primitives left an island of packages behind that nothing imported, and this ADR did
not address them. Iteration 8 removed all four (75 transitive packages):

- `class-variance-authority` — existed only for the deleted primitives' `cva` bases. Zero
  references.
- `radix-ui` — zero imports. (The one "radix" mention left in `globals.css` is a comment about
  Radix **Colors**, a token palette, which is a different thing entirely.)
- `clsx` + `tailwind-merge` — used only inside `src/lib/utils.ts`, whose `cn()` helper was itself
  imported by nothing. The whole island was kept alive only by its own members.

**The decision above is unchanged**: `shadcn` and `components.json` stay. `shadcn` is not
vestigial — `globals.css` imports its token layer (`@import "shadcn/tailwind.css"`) — and the CLI
remains the sanctioned generator for a future dialog or popover. `shadcn add` re-adds
`clsx`/`tailwind-merge`/`cn()` on its own when that day comes, so removing them now costs nothing
and is not a reversal.
