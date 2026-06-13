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

/**
 * Guard for destructive integration tests: throw unless `connectionString`
 * targets the local/CI throwaway database. This prevents a stray `DATABASE_URL`
 * pointing at a real database from being TRUNCATEd by the test suite.
 */
export function assertDisposableTestDb(connectionString: string): void {
  const { hostname, pathname } = new URL(connectionString);
  const isLocalHost = hostname === "127.0.0.1" || hostname === "localhost";
  if (!isLocalHost || pathname !== "/say_it_with_a_playlist") {
    throw new Error(
      `Refusing to run destructive integration tests against ${hostname}${pathname}. ` +
        `Point DATABASE_URL at the local say_it_with_a_playlist database.`,
    );
  }
}
