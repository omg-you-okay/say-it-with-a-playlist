// Shared formatting rules for every developer. Editors pick this up via the
// committed .vscode/settings.json; CI/terminal use `pnpm format` / `format:check`.
/** @type {import("prettier").Config} */
const config = {
  // Import sorting is owned here (not by anyone's editor "sort imports" setting),
  // so the order is identical for everyone. Groups, separated by blank lines:
  //   node builtins · third-party · "@/..." aliases · relative imports
  // NOTE: prettier-plugin-tailwindcss MUST be loaded last (official requirement).
  plugins: [
    "@ianvs/prettier-plugin-sort-imports",
    "prettier-plugin-tailwindcss",
  ],
  importOrder: [
    "<BUILTIN_MODULES>",
    "",
    "<THIRD_PARTY_MODULES>",
    "",
    "^@/(.*)$",
    "",
    "^[./]",
  ],
  importOrderParserPlugins: ["typescript", "jsx", "decorators-legacy"],

  // Tailwind class sorting (prettier-plugin-tailwindcss).
  // v4: point at the CSS entry so custom theme utilities sort correctly.
  tailwindStylesheet: "./src/app/globals.css",
  // Also sort class strings passed to these helpers (used in components/ui).
  tailwindFunctions: ["cva", "cn"],
};

export default config;
