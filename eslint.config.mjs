import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import boundaries from "eslint-plugin-boundaries";
import { defineConfig, globalIgnores } from "eslint/config";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // iDesign call-direction rules — locked decisions, see CLAUDE.md §4 and src/server/README.md.
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { boundaries },
    settings: {
      "import/resolver": {
        typescript: { alwaysTryTypes: true },
      },
      "boundaries/ignore": ["**/*.test.ts", "**/*.test.tsx"],
      "boundaries/elements": [
        // A manager-resource: a Resource in the caller's subsystem whose "external
        // system" is another subsystem's Manager — the one sanctioned cross-subsystem
        // touchpoint (ADR 0009). Named `<TargetManager>Resource`. Must precede the
        // generic resource type so it is classified here, not as a plain resource.
        {
          type: "manager-resource",
          pattern: "src/server/*/resources/*ManagerResource*",
          mode: "file",
          capture: ["subsystem"],
        },
        {
          type: "manager",
          pattern: "src/server/*/managers/**/*",
          mode: "file",
          capture: ["subsystem"],
        },
        {
          type: "engine",
          pattern: "src/server/*/engines/**/*",
          mode: "file",
          capture: ["subsystem"],
        },
        {
          type: "resource",
          pattern: "src/server/*/resources/**/*",
          mode: "file",
          capture: ["subsystem"],
        },
        {
          type: "server-shared",
          pattern: "src/server/shared/**/*",
          mode: "file",
        },
        { type: "app", pattern: "src/app/**/*", mode: "file" },
        {
          type: "ui",
          pattern: "src/(components|hooks|lib)/**/*",
          mode: "file",
        },
      ],
    },
    rules: {
      // Fail loudly if a file under src/ matches no element type, so the
      // architecture taxonomy stays exhaustive instead of silently
      // unconstrained (e.g. a stray file directly in src/ or a future
      // src/middleware.ts would otherwise escape all boundary rules).
      "boundaries/no-unknown-files": "error",
      "boundaries/dependencies": [
        "error",
        {
          default: "disallow",
          rules: [
            {
              from: { type: "app" },
              allow: {
                to: { type: ["app", "ui", "manager", "server-shared"] },
              },
            },
            { from: { type: "ui" }, allow: { to: { type: "ui" } } },
            {
              from: { type: "manager" },
              allow: { to: { type: "server-shared" } },
            },
            {
              from: { type: "manager" },
              allow: {
                to: {
                  type: ["engine", "resource", "manager-resource"],
                  captured: { subsystem: "{{from.subsystem}}" },
                },
              },
            },
            {
              from: { type: "engine" },
              allow: { to: { type: "server-shared" } },
            },
            {
              from: { type: "engine" },
              allow: {
                to: {
                  type: ["resource", "manager-resource"],
                  captured: { subsystem: "{{from.subsystem}}" },
                },
              },
            },
            // A manager-resource is the cross-subsystem adapter (ADR 0009): it reaches
            // the public Manager of any subsystem (the one upward call the architecture
            // sanctions), plus shared utils.
            {
              from: { type: "manager-resource" },
              allow: { to: { type: ["manager", "server-shared"] } },
            },
            {
              from: { type: ["resource", "server-shared"] },
              allow: { to: { type: "server-shared" } },
            },
          ],
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
