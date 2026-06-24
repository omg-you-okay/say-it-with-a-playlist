# 0010 — Apply iDesign at the architecture level; keep idiomatic TypeScript

Date: 2026-06-25 · Status: accepted

## Context

iDesign originates in the C#/.NET world, where components are classes with interfaces and
constructor injection. The project owner is learning iDesign to carry into a future C#
project and asked whether this Node/TypeScript codebase should be rewritten in that
class-first idiom (`class AuthEngine implements IAuthEngine`, `I`-prefixed interfaces,
DI-container wiring).

The risk of doing so is a hybrid that imitates C# surface syntax inside Node — confusing in
both directions and idiomatic in neither. The codebase already implements iDesign correctly
using factory functions that return an interface and take injected dependencies
(`createAuthEngine(config)`, `makeUserManager(deps)`), with call-direction enforced by
`eslint-plugin-boundaries`.

## Decision

**iDesign is applied at the architecture level, and the code stays idiomatic TypeScript.**

- The transferable, language-agnostic core of iDesign — decomposition by volatility, the
  Manager / Engine / Resource layering, the call-direction rules, subsystem boundaries, the
  manager-resource cross-subsystem adapter ([0009]) — is what we practice and enforce.
- Components are **factory functions returning an interface**, with dependencies injected as
  parameters. No conversion to classes, `I`-prefixed interfaces, or a DI container.
- Stateless helpers (`normalize`, env parsing, session sign/verify, cookie config, the db
  pool) stay plain functions — they are not modelled as components.
- The one rule that prevents a "Frankenstein": **stay consistent** — one idiom across the
  whole codebase.

## Consequences

- The architecture lessons transfer cleanly to C#; the class/interface/DI syntax is learned
  in C# when an actual C# project exists, in its native habitat.
- This is a convention, not enforced by tooling; reviews keep it consistent.
- No rewrite of the existing Identity subsystem — it already follows this convention.
