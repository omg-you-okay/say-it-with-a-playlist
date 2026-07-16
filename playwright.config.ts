import { defineConfig, devices } from "@playwright/test";

import { E2E_SESSION_SECRET } from "./e2e/session";

// End-to-end tests against a real browser (ADR 0018).
//
// These exist because the unit suite structurally cannot see the bugs that hurt
// most: Iteration 6 shipped five layout bugs past a green lint, typecheck and
// 188 passing tests, because jsdom has no layout engine and cannot tell you that
// an element escaped its scroll container. Every one was found by looking at a
// real browser. Now that the app is deployed, that class of bug reaches users.

// Playwright does not read `.env` (Next does). Pin the session secret on this
// process and hand the same value to the server below, so the cookie the tests
// sign is one the app will actually verify.
process.env.SESSION_SECRET = E2E_SESSION_SECRET;

const PORT = 3100;

export default defineConfig({
  testDir: "./e2e",
  // A layout assertion that passes only sometimes is worse than none: it trains
  // you to re-run until green. Fail on `test.only` left in a commit, and retry
  // in CI only, where flake is usually the runner rather than the app.
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // In CI, also write the self-contained HTML report — its output folder embeds
  // the `retain-on-failure` traces below, so uploading `playwright-report/` from
  // the workflow captures the filmstrip. Without it there is nothing to upload
  // and a CI-only layout failure is undebuggable.
  reporter: process.env.CI
    ? [["github"], ["list"], ["html", { open: "never" }]]
    : [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    // Keep the trace from the first failed attempt — layout bugs are far easier
    // to read as a filmstrip than as an assertion diff.
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    // The v3 design is responsive and the shipped layout bugs were width-
    // dependent, so mobile is a first-class target, not an afterthought.
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    // `pnpm start`, not `pnpm dev`: dev-mode React and Turbopack's dev output
    // differ from what ships. Test the production build. CI already ran
    // `pnpm build` as its own step (a build break should read as a build
    // failure, not a mysterious e2e timeout), so this only serves it; the
    // `pnpm e2e` script builds first for local runs.
    command: `pnpm exec next start -p ${PORT}`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      // `page.tsx` builds a PlaylistManager *and* a UserManager just to do two
      // Postgres reads, and both eagerly `requireEnv` all three SPOTIFY_* vars —
      // the over-provisioning already logged as debt in the roadmap. Nothing here
      // reaches Spotify (every call is intercepted), so these are placeholders
      // whose only job is to satisfy that eager check. Fixing the debt would let
      // them go.
      SPOTIFY_CLIENT_ID: process.env.SPOTIFY_CLIENT_ID ?? "e2e-client-id",
      SPOTIFY_CLIENT_SECRET:
        process.env.SPOTIFY_CLIENT_SECRET ?? "e2e-client-secret",
      SPOTIFY_REDIRECT_URI:
        process.env.SPOTIFY_REDIRECT_URI ??
        `http://127.0.0.1:${PORT}/api/auth/callback`,
      SESSION_SECRET: E2E_SESSION_SECRET,
      DATABASE_URL:
        process.env.DATABASE_URL ??
        "postgresql://postgres:postgres@127.0.0.1:5432/say_it_with_a_playlist",
    },
  },
});
