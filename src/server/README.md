# Server — iDesign subsystem layout

Two strictly separated logical subsystems inside one deployable (see CLAUDE.md §4 — locked decisions):

```
identity/                       playlist/
  managers/UserManager            managers/PlaylistManager   (backtracking loop lives here)
  engines/AuthEngine, UserEngine  engines/SentenceEngine, SpotifyEngine
  resources/UserResource,         resources/SpotifyResource, PlaylistResource
            TokenResource
shared/                         # db client, config, pure utils — not an Engine
```

## Call-direction rules (enforced by `boundaries/element-types` in eslint.config.mjs)

- The HTTP/UI layer (`src/app`) talks to **Managers only**.
- Managers call Engines and Resources **within their own subsystem**.
- Engines never call other Engines; Engines may call same-subsystem Resources.
- Resources are the lowest layer and only use `shared/`.
- Identity and Playlist never import each other's Managers/Engines/Resources.
- **Crossing the boundary (the one sanctioned touchpoint — ADR 0009):** a
  **manager-resource** lives in the caller's subsystem and calls the other subsystem's
  **Manager** (its public front door). It is a Resource, named `<TargetManager>Resource`
  (file pattern `*ManagerResource*`), and same-subsystem Managers/Engines may call it like
  any Resource. Example (Iteration 3): `playlist/resources/UserManagerResource` →
  `UserManager.getFreshAccessToken`. `TokenResource` is Identity-private; Managers never
  call Managers directly.

Test files (`*.test.ts`) are exempt from boundary rules.
