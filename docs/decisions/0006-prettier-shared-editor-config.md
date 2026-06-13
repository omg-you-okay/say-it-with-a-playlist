# 0006 — Prettier + committed editor settings for consistent formatting

Date: 2026-06-12 · Status: accepted

## Context

Formatting depended on each developer's personal editor config. With no
project-level formatter, "format on save" produced different results per
machine (quote style, trailing commas, import order), creating noisy,
non-substantive diffs. ESLint was already set up for code-quality and the
iDesign boundary rules, but it is not a formatter.

## Decision

- **Prettier is the formatter**, configured by `prettier.config.mjs` and run via
  `pnpm format` / `pnpm format:check`. ESLint stays responsible for code quality
  and boundaries; the two don't overlap (Prettier formats, ESLint lints).
- **Import order is owned by Prettier** via `@ianvs/prettier-plugin-sort-imports`
  (groups: node builtins · third-party · `@/` aliases · relative), so order is
  identical for everyone rather than dependent on an editor's "sort imports".
- **`.vscode/settings.json` is committed** and pins Prettier as the format-on-save
  formatter. Workspace settings override each developer's User settings, so the
  project's config wins regardless of personal setup. `.vscode/extensions.json`
  recommends the Prettier + ESLint extensions.

## Alternatives considered

- **ESLint-only (no Prettier):** ESLint's `--fix` can't reflow code the way a
  formatter does; stylistic ESLint rules are slower and noisier than Prettier.
- **Leave it to personal editor settings:** the status quo that caused the
  inconsistent-diff problem.
- **Prettier without committed `.vscode/settings.json`:** rules would be shared
  but each dev would still have to wire up format-on-save themselves.

## Consequences

Formatting is deterministic across machines and CI-checkable (`pnpm format:check`
can be added to the pipeline). New contributors get the right behaviour by
installing the recommended extensions. Adds two devDependencies (`prettier`,
the sort-imports plugin).
