/** @format */

import { defineConfig } from "vite-plus";

export default defineConfig({
  staged: {
    "**/.agents/**": "",
    "**/*.{ts,tsx}": "vp check --fix",
  },
  fmt: {
    ignorePatterns: ["dist/*", ".agents/*", "node_modules/*"],
  },
  lint: {
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
    ignorePatterns: ["dist/*", ".agents/*", "node_modules/*"],
  },
});
