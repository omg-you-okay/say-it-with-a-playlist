# 0002 — Frontend session: httpOnly signed cookie

Date: 2026-06-11 · Status: accepted

## Context

Open decision from the brief (§8): after the Spotify OAuth round trip, how does the frontend know the user is logged in — session cookie or app-issued token?

## Decision

An **httpOnly, SameSite=Lax, signed cookie** (JWT signed with `jose`; payload is the app user id, not Spotify data). Issued by the OAuth callback handler, read by route handlers/server components. Spotify access/refresh tokens stay in the database, server-side only (locked decision).

## Alternatives considered

App-issued bearer token held in client JS: needed only for cross-origin or native clients (non-goals for MVP); exposes the session to XSS for no benefit on a same-origin app.

## Consequences

Auth state is invisible to client JS; logout = clearing the cookie. If a native app ever appears (explicit non-goal), a token-based scheme can be added alongside.
