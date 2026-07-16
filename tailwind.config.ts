import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class", '[data-theme="dark"]'],
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // legacy — still referenced by components/ui/input.tsx
        background: "var(--canvas)",
        foreground: "var(--text-primary)",
        // Cadence tokens
        canvas: "var(--canvas)",
        surface: "var(--surface)",
        "surface-inset": "var(--surface-inset)",
        "border-hair": "var(--border)",
        "border-strong": "var(--border-strong)",
        ink: {
          DEFAULT: "var(--text-primary)",
          secondary: "var(--text-secondary)",
          muted: "var(--text-muted)",
        },
        teal: {
          100: "#9fe1cb", 200: "#5dcaa5", 300: "#4bb795",
          400: "#3da583", 500: "#2e7a64", 600: "#24604f",
          700: "#1d9e75", 800: "#0f6e56",
        },
        coral: { DEFAULT: "#d85a30", soft: "#f0a888", flame: "#ef8a63", deep: "#c24a2a" },
        gold: { DEFAULT: "#e8c674", text: "#f0e4c4", pill: "#ecd08a", deep: "#b5a878", light: "#c99328" },
      },
      fontFamily: {
        display: ["var(--font-space-grotesk)", "sans-serif"],
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
      },
      borderRadius: { card: "12px", control: "10px", pill: "20px", chip: "10px" },
      transitionDuration: { tempo: "200ms" },
    },
  },
  plugins: [],
};
export default config;
