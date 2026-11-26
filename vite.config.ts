import { defineConfig } from "vite-plus";
import vinext from "vinext";
import path from "node:path";
import { cloudflare } from "@cloudflare/vite-plugin";
import { responseStoreAdapter } from "@vinext/cloudflare/cache/response-store-adapter";
import { imagesOptimizer } from "@vinext/cloudflare/images/images-optimizer";
import { responseStoreServiceBinding } from "./cloudflare.config";

const DB_TEST_FILES = [
  "tests/ai-credentials-api.test.ts",
  "tests/ai-credentials-service.test.ts",
  "tests/billing-api.test.ts",
  "tests/billing-entitlements.test.ts",
  "tests/codex-interchange-card-service.test.ts",
  "tests/codex-interchange-coordination.test.ts",
  "tests/codex-interchange-service.test.ts",
  "tests/codex-service.test.ts",
  "tests/codex-ui.test.ts",
  "tests/export.test.ts",
  "tests/import.test.ts",
  "tests/library-service.test.ts",
  "tests/novel-structure-lock.test.ts",
  "tests/prisma-8.test.ts",
  "tests/prompts-contracts-service.test.ts",
  "tests/prompts-seed-race.test.ts",
  "tests/prompts-service.test.ts",
  "tests/supabase-auth.test.ts",
  "tests/writing-service.test.ts",
];

export default defineConfig(({ command }) => ({
  // vinext/Cloudflare plugins rewrite modules for the Workers runtime and break Vitest's module runner.
  plugins: process.env.VITEST
    ? []
    : [
        vinext({
          cache: responseStoreAdapter(),
          images: { optimizer: imagesOptimizer() },
        }),
        // Browser E2E uses vinext's Node dev runtime so Prisma can use its
        // long-lived local singleton instead of per-request Workers I/O.
        ...(command === "serve" && process.env.INKSTORY_E2E === "1"
          ? []
          : [
              cloudflare({
                auxiliaryWorkers: [{ config: responseStoreServiceBinding }],
                viteEnvironment: {
                  name: "rsc",
                  childEnvironments: ["ssr"],
                },
              }),
            ]),
      ],
  resolve: {
    noExternal: ["tailwindcss"],
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
      // Under Vitest the vinext plugin is off, so point next/* at vinext's shims directly.
      ...(process.env.VITEST
        ? {
            "next/server": "vinext/shims/server",
            "next/link": "vinext/shims/link",
            "next/navigation": "vinext/shims/navigation",
            "next/headers": "vinext/shims/headers",
            "next/dist/shared/lib/app-router-context.shared-runtime":
              "vinext/shims/internal/app-router-context",
          }
        : {}),
    },
  },
  test: {
    setupFiles: ["./tests/setup-env.ts"],
    exclude: [
      "tests/e2e/**",
      "node_modules/**",
      "dist/**",
      ...(process.env.INKSTORY_NO_DB === "1" ? DB_TEST_FILES : []),
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html", "lcov"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.d.ts", "src/lib/supabase/types.ts"],
    },
  },
  staged: {
    "**/.agents/**": "",
    "**/*.{ts,tsx}": "vp check --fix",
  },
  fmt: {
    ignorePatterns: [
      "dist/*",
      ".agents/*",
      "node_modules/*",
      ".agents/claude/homunculus/**",
      "prisma/contract.d.ts",
      "prisma/contract.json",
    ],
  },
  lint: {
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
    ignorePatterns: ["dist/*", ".agents/*", "node_modules/*", "prisma/contract.d.ts"],
  },
}));
