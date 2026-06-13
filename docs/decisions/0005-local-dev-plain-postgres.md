# 0005 — Local dev database: plain Postgres container, not the Supabase CLI stack

Date: 2026-06-12 · Status: accepted · Supersedes part of [0001](0001-stack-nextjs-supabase-shadcn.md)

## Context

0001 chose Supabase as Postgres-only (not Supabase Auth) and, for local dev,
leaned on the Supabase CLI's local stack (`pnpm supabase start`). In practice
that stack boots the **entire** Supabase platform — ~13 containers and ~7 GB of
images (Studio, GoTrue/auth, PostgREST, Realtime, Storage, imgproxy,
edge-runtime, Kong, Logflare, Vector, Inbucket, pg-meta) — of which this app
uses exactly one: Postgres. We explicitly do not use Supabase Auth (0002) or
PostgREST (Resources talk to Postgres directly), so the rest is dead weight on
every developer's machine.

## Decision

- **Local dev runs a single `postgres:17-alpine` container** via `docker-compose.yml`
  (services: `db`). No Supabase CLI; the `supabase` devDependency and `supabase/`
  config dir are removed.
- **Health-based readiness** via a `pg_isready` healthcheck (satisfies the brief's
  "health-based readiness, not mere start order").
- **Connection via `DATABASE_URL`** (`postgresql://postgres:postgres@127.0.0.1:5432/say_it_with_a_playlist`),
  replacing `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` in `.env`.
- **Data access uses a direct Postgres driver** (`pg`), not `supabase-js` — there
  is no PostgREST/Kong gateway locally, and the service-role-key model only exists
  inside the Supabase platform. Resources wrap the `pg` pool. (`pg` is added in the
  iteration that first needs it — YAGNI.)
- **Migrations** are plain `.sql` files in `db/init/`, run by Postgres'
  `docker-entrypoint-initdb.d` on a fresh volume; `pnpm db:reset` re-applies them.
- **Production stays on Supabase managed Postgres** — still just Postgres reached
  by a connection string, so this is a dev-environment change only.

## Alternatives considered

- **Keep the full Supabase CLI stack:** standard Supabase workflow and bundled
  migration tooling/Studio, but ~7 GB and 12 unused services for a 3-table app.
- **Slim the CLI stack** (disable services in `config.toml`): fewer containers but
  still couples dev to the CLI and its assumptions; more moving parts than one
  Postgres container.
- **Hosted Supabase only, no Docker:** simplest to start, but shared cloud DB,
  no offline dev, awkward reset, and conflicts with the brief's containerised
  local environment.

## Consequences

Dev environment drops from ~13 containers to 1. Data access standardises on `pg`
rather than `supabase-js`; production data access must use the same driver to
stay consistent. Losing the Supabase CLI means no bundled Studio/migration
tooling — acceptable now; a lightweight migration tool (e.g. dbmate / node-pg-migrate)
can be added later if `db/init` SQL files become unwieldy.
