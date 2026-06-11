# Say It With a Playlist

Type a sentence, sign in with Spotify, and get a real playlist on your account whose track titles — read in order — spell out the sentence.

Full project brief and locked architecture decisions: [CLAUDE.md](CLAUDE.md). Architectural choices are logged in [docs/decisions/](docs/decisions/).

## Stack

Next.js (App Router, TypeScript) full-stack · Supabase (Postgres) · shadcn/ui + Tailwind · Vitest

## Local development

```bash
pnpm install
pnpm supabase start   # local Postgres etc. (requires Docker)
cp .env.example .env  # then fill in the values
pnpm dev              # http://localhost:3000
```

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | run the dev server |
| `pnpm lint` | ESLint, including architecture-boundary rules |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` | Vitest, single run |
| `pnpm build` | production build |

## Architecture

One deployable, two strictly separated logical subsystems (Identity, Playlist) following iDesign layering — see [src/server/README.md](src/server/README.md). Layer and subsystem boundaries are enforced by ESLint and fail CI when violated.

## Workflow

`main` ← `develop` ← `feature/*` / `fix/*` / `chore/*`; all work lands via PR into `develop` with the CI check green. Commits follow `type(scope): description`.
