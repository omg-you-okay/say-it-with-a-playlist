# 0016 — Production deploy: Vercel Hobby + Neon, and the Spotify quota ceiling we accept

Date: 2026-07-13 · Status: accepted · **Supersedes the production half of
[ADR 0001](0001-stack-nextjs-supabase-shadcn.md)** (Supabase as the hosted database). ADR 0005's
local-dev decision — a plain `postgres:17-alpine` container — is untouched and still stands.

## Context

Everything through Iteration 7 shipped, and nothing was deployed. Shipping needed three answers
that had been deferred since Iteration 1: where the app runs, where the database lives, and how
secrets get there. Two constraints shaped all three.

**Supabase's free tier stopped being suitable.** ADR 0001 picked Supabase as managed Postgres on
the strength of its free tier. That tier now **pauses a project after 7 days of inactivity**, and
resuming it requires a human clicking a button in a dashboard. This app's usage pattern is exactly
the pathological case: quiet for weeks, then shown to somebody. A demo that is dead on arrival
unless its owner remembered to log into a dashboard first is not deployed in any meaningful sense.

**Spotify closed the door on public access, and we found out before spending effort on it.** On
**11 February 2026** Spotify rewrote Development Mode. Client IDs created after that date — ours
was created around 13 June 2026 — are capped at **5 test users**, each needing Spotify Premium,
with one Development Mode client ID per developer. The escape hatch, Extended Quota Mode, now
requires a legally registered business and 250,000 monthly active users. It is not a bar this
project can clear, and no amount of engineering changes that.

## Decision

**Host on Vercel Hobby.** Next.js is Vercel's own framework; the Git integration deploys `main` on
push with no workflow to maintain, and the free tier covers this app's traffic several orders of
magnitude over. The existing GitHub Actions CI still guards the PR, so `main` stays deployable.

**Database on Neon's free tier**, using the **pooled** (`-pooler`) connection endpoint. Neon
scales compute to zero when idle and **resumes on the next query in under 500ms, with no human in
the loop** — the precise property Supabase's free tier lost. The pooled endpoint fronts PgBouncer,
which is what makes a fleet of short-lived serverless instances survivable.

**Accept the 5-user ceiling as a product constraint, and design nothing around it.** The app is
deployed for its owner and up to four allowlisted people. Consequently we build **no rate
limiting, no abuse protection, and no signup flow** — Spotify's allowlist _is_ the gate, and it is
a stronger one than anything we would write. This is recorded so a future reader does not mistake
those absences for oversights.

**Secrets live in the platform's environment configuration** — Vercel project env vars in
production, a gitignored `.env` locally. No secrets in source, no secrets in CI beyond the
throwaway Postgres the test job spins up. The production `SESSION_SECRET` is generated fresh and
never shared with the local one, so a leaked dev secret cannot mint production sessions.

## Consequences

- **Two code changes were required**, both small and both in this iteration: the pool caps at 5
  connections with idle reaping (each serverless instance builds its own pool, so the real ceiling
  is instances × max), and the streaming preview route pins `runtime = "nodejs"` (`pg` needs TCP
  sockets, which the Edge runtime does not have) and `maxDuration = 60` (the search loop is
  bounded by `maxSearches`, not by the clock, and the platform default would cut the NDJSON stream
  mid-search).
- **TLS is negotiated from the connection string's `sslmode`, not hard-coded.** The hosted URL
  carries `?sslmode=require`; the local container speaks no TLS and its URL omits it. One code
  path, no `NODE_ENV` branch.
- **PgBouncer's transaction pooling is compatible with the row lock in
  [ADR 0017](0017-serialized-token-refresh.md)** — a transaction is pinned to one server
  connection for its whole life. We use no session-level features (no session advisory locks, no
  named prepared statements), so there is nothing to trip over.
- **Migrations stay manual**: `DATABASE_URL=<neon> pnpm db:migrate`, run once by hand. Both SQL
  files are `CREATE … IF NOT EXISTS`, so re-running is safe. A migration step in the deploy
  pipeline is not yet worth its weight (YAGNI); revisit when a schema change actually ships.
- **The Hobby plan forbids commercial use.** Fine for this project; a constraint to remember if
  that ever changes.

## Alternatives considered

- **Stay on Supabase** (honouring ADR 0001 as written). Rejected on the 7-day pause alone. Its
  other free-tier advantages — auth, storage, realtime — are things this app deliberately does not
  use (ADR 0002 chose our own session cookie; ADR 0005 already pared the local stack down to
  Postgres). We were using one of Supabase's thirteen services, and paying for that choice with
  the one property we could not live with.
- **Fly.io / Railway** (a long-running container rather than serverless). Both would sidestep the
  connection-pool question and the function timeout entirely, and a persistent process would make
  the token-refresh lock a simple in-process mutex. Rejected because neither has a free tier that
  survives idling as gracefully, and because a long-running host for an app with five users is
  weight we would carry for no return. The serverless constraints turned out to be cheap to
  satisfy — two small code changes — and the architecture was already clean enough to absorb them.
- **Vercel Postgres.** Effectively Neon under the hood, with less control and a tighter free tier.
  No reason to prefer the wrapper.
