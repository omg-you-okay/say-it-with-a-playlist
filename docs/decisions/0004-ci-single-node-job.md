# 0004 — CI: single Node job, replacing the .NET/Nx template

Date: 2026-06-11 · Status: accepted

## Context

The committed `ci.yml` was a template for a .NET backend + Nx frontend that never existed; any PR into `develop` would have failed its required check. The brief mandates that CI only contains steps for code that exists, growing with the project.

## Decision

One `build-and-test` job on `pull_request` into `develop` and `main`: pnpm install → `pnpm lint` → `pnpm typecheck` → `pnpm test` → `pnpm build`. Lint includes the architecture-boundary rules, so layering violations fail CI.

## Consequences

Future steps (Playwright e2e smoke, deploy) are added only when that code exists. The branch-protection ruleset keeps requiring this check; the job name (`build-and-test`) was kept so existing protection still matches.
