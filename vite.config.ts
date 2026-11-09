import { defineConfig } from "vite-plus";
import vinext from "vinext";
import path from "path";
import { cloudflare } from "@cloudflare/vite-plugin";
import { responseStoreAdapter } from "@vinext/cloudflare/cache/response-store-adapter";
import { imagesOptimizer } from "@vinext/cloudflare/images/images-optimizer";
import { responseStoreServiceBinding } from "./cloudflare.config";

export default defineConfig({
  // vinext/Cloudflare plugins rewrite modules for the Workers runtime and break Vitest's module runner.
  plugins: process.env.VITEST
    ? []
    : [
        vinext({
          cache: responseStoreAdapter(),
          images: { optimizer: imagesOptimizer() },

          prerender: { routes: "*" },
        }),
        cloudflare({
          auxiliaryWorkers: [{ config: responseStoreServiceBinding }],
          viteEnvironment: {
            name: "rsc",
            childEnvironments: ["ssr"],
          },
        }),
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
    exclude: ["tests/e2e/**", "node_modules/**", "dist/**"],
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
    ignorePatterns: ["dist/*", ".agents/*", "node_modules/*", ".agents/claude/homunculus/**"],
  },
  lint: {
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
    ignorePatterns: ["dist/*", ".agents/*", "node_modules/*"],
  },
});
