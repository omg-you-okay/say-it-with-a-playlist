# Deployment

Vercel (Hobby) + Neon (free), both at $0. The _why_ is [ADR 0016](decisions/0016-deploy-vercel-hobby-neon.md);
this is the runbook.

## Before you start: who can actually use this

Spotify rewrote Development Mode on **11 February 2026**. This app's client ID was created after
that, so it is capped at **5 test users**, each of whom needs **Spotify Premium**, and each of whom
you must add by hand in the Spotify dashboard. Extended Quota Mode — the thing that would make it
open to anyone — requires a registered business and 250k monthly active users, and is not
reachable for this project.

So: deploying gives you a real, live, HTTPS URL that works perfectly **for you and up to four
people you name**. Anyone else who opens it can load the page but cannot log in. That is a Spotify
policy ceiling, not a bug, and there is no code that fixes it.

## Environment variables

| Variable                | Local (`.env`)                                                         | Production (Vercel)                  |
| ----------------------- | ---------------------------------------------------------------------- | ------------------------------------ |
| `DATABASE_URL`          | `postgresql://postgres:postgres@127.0.0.1:5432/say_it_with_a_playlist` | Neon **pooled** URL (see below)      |
| `SESSION_SECRET`        | `openssl rand -base64 32`                                              | **A different one.** Generate fresh. |
| `SPOTIFY_CLIENT_ID`     | from the Spotify dashboard                                             | same                                 |
| `SPOTIFY_CLIENT_SECRET` | from the Spotify dashboard                                             | same                                 |
| `SPOTIFY_REDIRECT_URI`  | `http://127.0.0.1:3000/api/auth/callback`                              | `https://<domain>/api/auth/callback` |

Two things that look like typos but are not:

- **Local uses `127.0.0.1`, not `localhost`.** Spotify rejects `http://localhost` redirect URIs for
  new apps. The two are also distinct cookie origins, so mixing them silently strands your session.
- **The production `SESSION_SECRET` must not be the local one.** They sign session cookies; sharing
  them means a leaked dev secret can mint production sessions.

`NODE_ENV=production` is set by Vercel automatically, which is what flips the session cookie to
`Secure`. You do not set it yourself.

## 1. Database (Neon)

1. Create a free project at [neon.tech](https://neon.tech).
2. Copy the **pooled** connection string — the host contains `-pooler`. This one, not the direct
   one: it fronts PgBouncer, which is what makes a fleet of short-lived serverless instances
   survivable. It ends in `?sslmode=require`, and that parameter is load-bearing — TLS is
   negotiated from the URL, not from code.
3. Create the schema, once, from your laptop:

   ```sh
   DATABASE_URL='<neon-pooled-url>' pnpm db:migrate
   ```

   Safe to re-run: both SQL files are `CREATE … IF NOT EXISTS`. There is no migration step in the
   deploy pipeline — add one when a schema change actually ships, not before.

The test suite cannot touch this database even by accident: `assertDisposableTestDb` refuses to run
the destructive integration tests against any host that is not local.

## 2. Vercel

1. Import the GitHub repo. Next.js is auto-detected; no build configuration needed.
2. **Set all five environment variables before the first deploy.** The home page builds its managers
   eagerly, so a missing `SPOTIFY_*` var fails the render rather than degrading.
3. Deploy. The Git integration ships `main` on every push from then on; GitHub Actions CI still
   guards the PR, so `main` stays deployable.

## 3. Spotify dashboard

1. In your app's settings, add the production redirect URI:
   `https://<domain>/api/auth/callback`. **Keep the `127.0.0.1` one** — you need both, one per
   environment.
2. Add each person who should be able to log in to the **user allowlist** (name + the email on
   their Spotify account). Remember: five, Premium only.

## After the first deploy, check these four things

The unit tests cannot see any of them.

1. **Log in.** The OAuth round trip is where a cookie-origin bug would show up: if you land back on
   the home page still logged out, the session cookie was set on a different origin than the one you
   were redirected to.
2. **The progress view must _stream_.** Type a sentence and watch it. Lines should appear one at a
   time as the search runs. If the whole result appears at once at the end, a proxy is buffering the
   NDJSON response, and the single best feature of the app is silently dead. This is the most likely
   deploy-day surprise.
3. **Create a real playlist** and open the link. It should exist on your Spotify account.
4. **Come back an hour later and generate another one.** That is the only way to exercise the token
   refresh path ([ADR 0017](decisions/0017-serialized-token-refresh.md)) against real Spotify — the
   access token has to have actually expired.

## Cost

$0, and it stays $0 at this scale. The things that would eventually cost money — Vercel's Active
CPU hours, Neon's compute hours — are consumed by an app with at most five possible users. The
Hobby plan does forbid commercial use, which matters only if this ever stops being a portfolio
piece.
