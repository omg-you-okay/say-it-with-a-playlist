// Shared formatting rules for every developer. Editors pick this up via the
// committed .vscode/settings.json; CI/terminal use `pnpm format` / `format:check`.
/** @type {import("prettier").Config} */
const config = {
  // Import sorting is owned here (not by anyone's editor "sort imports" setting),
  // so the order is identical for everyone. Groups, separated by blank lines:
  //   node builtins · third-party · "@/..." aliases · relative imports
  plugins: ["@ianvs/prettier-plugin-sort-imports"],
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
};

export default config;
