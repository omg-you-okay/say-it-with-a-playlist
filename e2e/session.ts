// The e2e suite signs its own session cookie instead of walking Spotify's OAuth
// consent screen — that flow needs a real Premium account on the 5-person
// allowlist (ADR 0016), which CI will never have, and it is Spotify's code under
// test there, not ours. Minting the cookie with the app's own `createSessionToken`
// keeps the fake honest: if session signing changes, these tests fail rather than
// quietly authenticating against a format the app no longer accepts.
//
// This module is imported by `playwright.config.ts`, which sets SESSION_SECRET on
// the test process *and* hands the same value to the server it boots — so both
// sides agree by construction rather than by both happening to read `.env`
// (Playwright, unlike Next, does not load `.env` files).

// Any value ≥32 chars satisfies session.ts's minimum. It is a test secret in a
// public repo on purpose: it signs nothing that exists outside a CI run.
export const E2E_SESSION_SECRET =
  "e2e-session-secret-not-used-in-production-0123456789";

// A stable, arbitrary user id. No row needs to exist for it: `page.tsx` reads
// history and profile through `Promise.allSettled`, so an unknown id degrades to
// an empty history and a null display name instead of failing the page.
export const E2E_USER_ID = "00000000-0000-4000-8000-000000000001";
