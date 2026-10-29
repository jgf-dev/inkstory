import type { Config } from "tailwindcss";

/**
 * Color tokens live in `src/app/globals.css` as CSS variables (registered via
 * `@theme inline`) so the dark "Obsidian Desk" theme can invert the same ramp
 * at runtime. This config only carries the legacy prose serif stack.
 */
export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        serif: ["Georgia", "Cambria", "Times New Roman", "serif"],
      },
    },
  },
  plugins: [],
} satisfies Config;
