---
description: Start a clean feature session — load the next roadmap iteration, restate its locked constraints, branch, and plan before writing code.
argument-hint: "[iteration number or feature name; omit to use the next unfinished iteration]"
---

You are starting a **new feature session**. Keep it scoped to exactly one feature so its
context never bleeds into another. Do this in order and stop at the first thing that looks wrong.

## 1. Pick the target iteration
- Read @docs/roadmap.md.
- Target = `$ARGUMENTS`. If empty, choose the first iteration whose status is not `✅ DONE`.
- If the target is already done or ambiguous, **stop and ask** which iteration to start.

## 2. Load only the context this feature needs
- From the roadmap row: note the iDesign components to add, the "done when" criterion, and which ADRs it cites.
- Read the cited ADRs in @docs/decisions/ and restate, in your own words, the **locked constraints that bind this feature** (e.g. Managers→Engines/Resources call direction, Engines never call Engines, the session-cookie decision, the matching/substitution/naming rules). Do **not** relitigate them.
- If this iteration writes Next.js app code, heed @AGENTS.md (read the relevant guide under `node_modules/next/dist/docs/` before coding).

## 3. Branch (GitHub Flow, ADR 0007)
- Run `git status` and `git branch --show-current`.
- If not on a clean `main`, **stop** and surface the state instead of branching.
- Create `feature/<short-kebab-name>` off `main`.

## 4. Plan before code
- Enter plan mode. Produce a step-by-step plan for **this iteration only**: components to add (respecting the three layers), the tests written alongside each (auth/core logic non-negotiable), and the endpoint or behaviour that satisfies "done when".
- Do not edit files until the plan is approved.
