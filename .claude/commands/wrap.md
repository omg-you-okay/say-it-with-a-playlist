---
description: Close out a feature session — write status/decisions back to the version-controlled substrate so the next clean session starts correct, then prep the PR.
argument-hint: "[optional note about what was delivered]"
---

You are **wrapping up** the current feature session. The goal: move everything durable OUT of
this session's transient context and INTO the version-controlled substrate, so the next fresh
session is correct without inheriting this one's context. Extra context from the user: `$ARGUMENTS`

## 0. Model checkpoint — review stage
- This wrap runs a `/code-review` (step 3); recommended: **Opus 4.8, effort high**
  (better bug recall than Sonnet, and the review is short so the cost delta is small).
- State which model is currently powering you. If it doesn't match, ask the user to
  switch via `/model` and **wait for their confirmation** before proceeding. The doc
  write-back steps (1–2) are fine on Sonnet, but do not start step 3's review below Opus.

## 1. Review what actually changed
- Run `git status`, `git diff --stat main...HEAD`, and `git log --oneline main..HEAD`.
- Summarize what this feature delivered, measured against its roadmap "done when".

## 2. Write back project knowledge (the whole point)
- **Roadmap:** update @docs/roadmap.md — set this iteration's status (`✅ DONE`, or note precisely what remains). It stays the single source of truth.
- **Decisions:** if any architectural choice was made or changed, create the next-numbered ADR in @docs/decisions/ (context · decision · alternatives · consequences). If none, say so explicitly — don't invent one.
- **Doc sync:** if anything decided this session invalidates a claim in @CLAUDE.md or `src/server/README.md` (locked rules, component inventory, the §8 table), update those files now — they load into every fresh session and must never contradict the ADRs.
- **Memory:** update the project memory note `project-status-iterations.md` to a one-line current-status + next-step **pointer** (do not duplicate the full roadmap into memory).

## 3. Review the branch before it leaves the session
- Run `/code-review` on the branch diff. Fold trivial findings in now; log anything
  deferred as a follow-up on the iteration's roadmap entry (so it can't silently linger).
- Prune roadmap follow-ups that this branch closed.

## 4. Prep the PR — but do not push without confirmation
- Confirm tests/lint pass locally if applicable; report failures honestly.
- Propose a `type(scope): description` PR title and a body (what / why, tests, "done when" met).
- Then **ask** before pushing the branch and opening the PR into `main`.

## 5. Hand off clean
- Once the PR is up, tell the user: **the next iteration should start a fresh session — `/clear`
  before the next `/kickoff`.** Long (>150k) sessions are the single biggest usage driver, and
  everything durable from this one now lives in the roadmap/ADRs/memory — so Iteration N+1 has no
  reason to pay to carry Iteration N's context.
