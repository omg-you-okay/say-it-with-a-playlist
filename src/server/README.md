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
- Identity and Playlist never import each other.
- **Sanctioned exception (the one cross-subsystem touchpoint):** `TokenResource` is the
  shared token store — Identity writes it, Playlist *reads* it. Any Manager may import it;
  nothing else crosses the boundary.
- Cross-subsystem orchestration (e.g. "refresh token, then generate") is sequenced in the
  route handler, above the manager layer — Managers never call Managers.

Test files (`*.test.ts`) are exempt from boundary rules.
