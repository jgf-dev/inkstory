import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          50: "#f7f5f1",
          100: "#ece6d8",
          200: "#d8cfb6",
          300: "#b9a982",
          400: "#8a7a55",
          500: "#5e5236",
          600: "#3f3622",
          700: "#29220f",
          800: "#171106",
          900: "#0b0802",
        },
      },
      fontFamily: {
        serif: ["Georgia", "Cambria", "Times New Roman", "serif"],
      },
    },
  },
  plugins: [],
} satisfies Config;
