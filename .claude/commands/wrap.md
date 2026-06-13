---
description: Close out a feature session — write status/decisions back to the version-controlled substrate so the next clean session starts correct, then prep the PR.
argument-hint: "[optional note about what was delivered]"
---

You are **wrapping up** the current feature session. The goal: move everything durable OUT of
this session's transient context and INTO the version-controlled substrate, so the next fresh
session is correct without inheriting this one's context. Extra context from the user: `$ARGUMENTS`

## 1. Review what actually changed
- Run `git status`, `git diff --stat main...HEAD`, and `git log --oneline main..HEAD`.
- Summarize what this feature delivered, measured against its roadmap "done when".

## 2. Write back project knowledge (the whole point)
- **Roadmap:** update @docs/roadmap.md — set this iteration's status (`✅ DONE`, or note precisely what remains). It stays the single source of truth.
- **Decisions:** if any architectural choice was made or changed, create the next-numbered ADR in @docs/decisions/ (context · decision · alternatives · consequences). If none, say so explicitly — don't invent one.
- **Memory:** update the project memory note `project-status-iterations.md` to a one-line current-status + next-step **pointer** (do not duplicate the full roadmap into memory).

## 3. Prep the PR — but do not push without confirmation
- Confirm tests/lint pass locally if applicable; report failures honestly.
- Propose a `type(scope): description` PR title and a body (what / why, tests, "done when" met).
- Then **ask** before pushing the branch and opening the PR into `main`.
