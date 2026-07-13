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

// In production this runs on serverless instances, and *each* instance builds
// its own pool — so the per-instance ceiling is not the real limit, the number
// of live instances multiplied by it is. Keep it low and let the hosted pooler
// (Neon's `-pooler` endpoint) do the fan-in it exists for. It has to stay above
// 1: `TokenResource.withLockedTokens` holds one connection for the length of a
// refresh while a racing caller blocks on the row lock holding another.
const MAX_CONNECTIONS = 5;

export function getPool(): Pool {
  if (!globalForDb.__siwapPool) {
    globalForDb.__siwapPool = new Pool({
      // TLS is negotiated from the URL's `sslmode`, the standard Postgres knob:
      // the hosted DATABASE_URL carries `?sslmode=require`, and the local
      // docker-compose one omits it (that Postgres speaks no TLS). Hard-coding
      // `ssl` here would need a NODE_ENV branch and would break local dev.
      connectionString: requireEnv("DATABASE_URL"),
      max: MAX_CONNECTIONS,
      // A frozen serverless instance should not sit on an idle connection.
      idleTimeoutMillis: 10_000,
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
