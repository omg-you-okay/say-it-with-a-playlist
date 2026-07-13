# 0017 — Serialize token refresh on a Postgres row lock, and give a dead grant its own type

Date: 2026-07-13 · Status: accepted · Debt owed since Iteration 2 (the concurrent-refresh race)
and Iteration 3 (the `invalid_grant` dead end), paid before deploying because
[ADR 0016](0016-deploy-vercel-hobby-neon.md) makes both meaningfully more likely.

## Context

`UserManager.getFreshAccessToken` was read-then-write with no lock:

```
read tokens → if expired → refreshAccessToken(RT1) → save
```

Two concurrent callers both read the same expired row and both call Spotify with `RT1`. Spotify
_may_ rotate the refresh token on refresh, and when it does the interleaving is destructive:

- Caller **A** receives `RT2`, saves it. The stored grant is now live.
- Caller **B**, still holding `RT1`, either gets `invalid_grant` (the token was just consumed) —
  or, worse, succeeds. Spotify legitimately **omits** `refresh_token` from a refresh response, and
  `AuthEngine.normalize` correctly falls back to the token it was handed. So B saves `RT1` back
  over `RT2`. The stored refresh token is now dead, and the user is logged out permanently, with
  no way back short of re-consenting.

That fallback is right in isolation — it is what the OAuth spec asks for — and it is precisely
what converts a benign-looking race into data loss. The window is one HTTP round trip, once an
hour per user, so a single dev server rarely hits it. **Serverless changes the odds**: parallel
requests land on _separate instances_ that share no memory, and the home page render plus an
in-flight preview are exactly the kind of pair that arrives together.

Separately, when a grant is genuinely revoked (the user removed the app in their Spotify account),
`postToken` threw a bare `Error`, the preview route's catch-all turned it into `preview_failed`,
and the user hit a dead end — a generic failure with no hint that logging in again is the one
thing that would fix it.

## Decision

**Serialize the refresh on a Postgres row lock, with a double check.**

`TokenResource` gains `withLockedTokens(userId, fn)`: it opens a transaction, takes
`SELECT … FOR UPDATE` on the user's token row, and hands the callback the locked row plus a `save`
bound to the same transaction. `UserManager` keeps a **lock-free fast path** — the token is valid
almost every time, and that read should not pay for a transaction — and only enters the lock when
a refresh is actually due. Inside the lock it **re-checks expiry**: whoever it queued behind may
already have refreshed, in which case there is nothing to do but use the winner's token.

Exactly one caller performs the refresh; the loser never calls Spotify at all.

**Give a dead grant its own type.** `AuthEngine` throws `ReauthRequiredError` when Spotify answers
`invalid_grant` (RFC 6749 §5.2), distinguishing "this grant is dead and only the user can fix it"
from "Spotify fell over, and a retry might work." Both playlist routes map it to the
`login_required` code they already emit for `MissingTokensError` — so the fix required **no
frontend work at all**: the "session expired, please log in again" path already existed.

## Consequences

- **The lock lives in Postgres because Postgres is the only thing every instance shares.** This is
  the crux. An in-process mutex was the obvious first idea and is worthless here: it orders callers
  _within_ one instance and does nothing whatsoever _across_ them, which is the only case that
  matters on serverless.
- **A transaction is held open across an outbound HTTP call**, which is normally a smell. Accepted
  deliberately, and bounded: `AuthEngine` already imposes a 10s `AbortSignal.timeout`, so the lock
  cannot be held indefinitely; a refresh happens at most once an hour per user; and ADR 0016 caps
  the app at five users. The pool's `max` must stay above 1 for the same reason — the winner holds
  one connection through the refresh while the loser blocks on the row lock holding another.
- **Layering holds.** The transaction and the SQL stay inside the Resource; the sequencing (is it
  still stale? refresh, then save) stays in the Manager. This is the standard unit-of-work shape,
  and it is why the Manager can drive a transaction without learning what a transaction is.
- **`ReauthRequiredError` is re-exported from `UserManager`.** The eslint boundaries rules let an
  app route import from a Manager but never from an Engine, and that rule is correct — the Manager
  is Identity's public front door (ADR 0009). The type is defined where the OAuth knowledge lives
  and published where callers are allowed to reach.
- **The race is covered by a test that fails without the fix**, against real Postgres, because a
  faked resource cannot serialize anything: two parallel `getFreshAccessToken` calls must produce
  exactly one refresh. Run against the old code it fails with _"expected 1 times, but got 2
  times"_, which is the bug, reproduced.

## Alternatives considered

- **In-process mutex / promise cache** keyed by user id. Rejected: does not survive multiple
  instances, which is the entire problem. It would have "fixed" the bug locally and left it live in
  production — the worst outcome available.
- **Optimistic concurrency (compare-and-swap on the old refresh token).** `UPDATE … WHERE
refresh_token = RT1`, and the loser re-reads. It avoids holding a lock across HTTP, which is
  genuinely attractive. Rejected because it does not prevent the **duplicate Spotify call** — both
  callers still refresh, and the loser's call carries a token Spotify may have just invalidated, so
  it can fail with `invalid_grant` and surface as a spurious "please log in again" to a user whose
  grant is perfectly healthy. `FOR UPDATE` is strictly stronger: the loser never makes the call.
- **A `pg_advisory_xact_lock` on a hash of the user id.** Equivalent serialization without needing
  the row to exist. Rejected as a needless indirection — the row we want to protect is right there,
  and locking the thing itself says what it means. (Note the _transaction_-scoped variant would
  have been mandatory over the session-scoped one anyway, under PgBouncer.)
