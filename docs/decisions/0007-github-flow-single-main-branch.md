# 0007 — GitHub Flow: single `main` branch, drop `develop`

Date: 2026-06-12 · Status: accepted · Supersedes the branching part of CLAUDE.md §7

## Context

CLAUDE.md §7 specified GitFlow: `feature/* → develop → main`, with `develop`
as an integration branch and branch protection on `develop`. In practice this
is a solo project deploying continuously to a single environment. The `develop`
layer added a second PR per change with no integration or staging benefit, and
the protection ended up mismatched — the required `build-and-test` check was
enforced on `develop` while the actual foundations PR (#5) targeted `main`,
which had no protection at all.

## Decision

- **Adopt GitHub Flow:** `feature/* | fix/* | chore/* → main`. `main` is always
  deployable; deploys come from `main`.
- **Protect `main`** with the existing ruleset (retargeted from `develop`):
  require a pull request and a passing `build-and-test` status check, block
  force-pushes and deletion.
- **CI** triggers on pull requests into `main` only.
- **Retire `develop`** — no longer part of the flow.

## Alternatives considered

- **Keep GitFlow (`develop` + `main`):** valuable with parallel features, a
  staging/production split, or a team coordinating releases — none of which
  apply yet. Conflicts with the brief's own YAGNI principle at this stage.
- **Leave config as-is:** protection on `develop` but merging to `main` left
  `main` ungated; internally inconsistent.

## Consequences

One PR ships a change. `main` is the single protected, always-green branch.
If the project later grows a team or a staging environment, reintroducing a
`develop`/release branch is a small, well-understood change.
