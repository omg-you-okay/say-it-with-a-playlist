# 0001 — Stack: Next.js + Supabase (Postgres) + shadcn/ui

Date: 2026-06-11 · Status: accepted · Local-dev & data-access portions superseded by [0005](0005-local-dev-plain-postgres.md)

## Context

The brief (CLAUDE.md) is deliberately stack-agnostic but locks: a single deployable monolith with two logical subsystems (Identity, Playlist), iDesign layering (Managers/Engines/Resources), and backend-held Spotify tokens. A leftover CI template assumed .NET + Nx but matched no real code.

## Decision

- **Next.js (App Router, TypeScript) full-stack** — route handlers are the API, React pages the frontend: one deployable, satisfying the monolith constraint. No reverse proxy needed (single origin); the containerised dev environment from the brief becomes `next dev` + Supabase's local Docker stack.
- **Supabase as Postgres only — not Supabase Auth.** Supabase Auth's Spotify provider exposes `provider_token` to the client and doesn't manage provider refresh tokens, which would violate the locked token rules. Spotify OAuth is implemented in our own route handlers; tokens stored server-side. Data access via `supabase-js` with the service-role key, used only in server code, wrapped in Resource classes. Migrations via Supabase CLI SQL files.
- **shadcn/ui + Tailwind** for UI components.
- **Layer/subsystem boundaries enforced by `eslint-plugin-boundaries`** (see eslint.config.mjs) — violations fail lint, hence CI.

## Alternatives considered

- Keep .NET backend + Angular/Nx frontend (per leftover CI template): two deployables or extra wiring, conflicts with picking a single full-stack framework; no real code existed to preserve.
- Supabase Auth for sign-in: less code but leaks provider tokens to the client (locked-decision violation).
- Drizzle/Prisma ORM: deferred — three tables don't justify the tooling yet (YAGNI).

## Consequences

Single repo, single deployable, one CI job. A future extraction of subsystems into services remains a refactor, not a rewrite, as long as the lint-enforced boundaries hold.
