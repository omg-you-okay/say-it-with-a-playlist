# Database init scripts

Any `*.sql` or `*.sh` file in this directory is executed by the Postgres
container **the first time the data volume is created**, in alphabetical order
(Postgres `docker-entrypoint-initdb.d` convention). Use a numeric prefix to
order them, e.g. `001_users.sql`, `002_tokens.sql`.

These run only on a fresh volume. To re-run them against a clean database:

```bash
pnpm db:reset
```

Schema for the three persisted tables (users, tokens, playlist history) lands
here as it is built in later iterations.
