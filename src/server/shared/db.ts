import { Pool } from "pg";

import { requireEnv } from "./env";

// A single lazily-created connection pool, shared across the app.
//
// Lazy (not created at import time) so that `next build` — which evaluates
// modules without a database — does not require DATABASE_URL. The pool is
// cached on `globalThis` so Next.js hot-reload in dev reuses one pool instead
// of leaking a new one on every module reload.
//
// Resources are the only layer that should import this (see eslint boundaries).

const globalForDb = globalThis as typeof globalThis & {
  __siwapPool?: Pool;
};

export function getPool(): Pool {
  if (!globalForDb.__siwapPool) {
    globalForDb.__siwapPool = new Pool({
      connectionString: requireEnv("DATABASE_URL"),
    });
  }
  return globalForDb.__siwapPool;
}
