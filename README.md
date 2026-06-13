# Say It With a Playlist

Type a sentence, sign in with Spotify, and get a real playlist on your account whose track titles — read in order — spell out the sentence.

Full project brief and locked architecture decisions: [CLAUDE.md](CLAUDE.md). Architectural choices are logged in [docs/decisions/](docs/decisions/).

## Stack

Next.js (App Router, TypeScript) full-stack · Postgres (Supabase in prod, plain Postgres in dev) · shadcn/ui + Tailwind · Vitest

## Local development

```bash
pnpm install
pnpm db:up            # start local Postgres in Docker (waits until healthy)
cp .env.example .env  # then fill in the values
pnpm dev              # http://localhost:3000
```

Requires Docker. `DATABASE_URL` in `.env` points at the container started by `pnpm db:up`.

## Scripts

| Command          | What it does                                     |
| ---------------- | ------------------------------------------------ |
| `pnpm dev`       | run the dev server                               |
| `pnpm db:up`     | start local Postgres (Docker, detached)          |
| `pnpm db:down`   | stop & remove the Postgres container (data kept) |
| `pnpm db:reset`  | wipe the data volume and start fresh             |
| `pnpm db:logs`   | tail Postgres logs                               |
| `pnpm lint`      | ESLint, including architecture-boundary rules    |
| `pnpm typecheck` | `tsc --noEmit`                                   |
| `pnpm test`      | Vitest, single run                               |
| `pnpm build`     | production build                                 |

## Architecture

One deployable, two strictly separated logical subsystems (Identity, Playlist) following iDesign layering — see [src/server/README.md](src/server/README.md). Layer and subsystem boundaries are enforced by ESLint and fail CI when violated.

## Workflow

GitHub Flow: `feature/*` / `fix/*` / `chore/*` → `main`; all work lands via PR into `main` with the CI check green (`main` is protected). Commits follow `type(scope): description`. See [docs/decisions/0007](docs/decisions/0007-github-flow-single-main-branch.md).
