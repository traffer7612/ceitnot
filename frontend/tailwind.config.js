/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        aura: {
          bg: "#0a0a0f",
          surface: "#12121a",
          border: "#1e1e2e",
          muted: "#6b6b80",
          gold: "#d4a853",
          "gold-dim": "#9a7b3a",
          accent: "#8b5cf6",
          success: "#22c55e",
          danger: "#ef4444",
        },
      },
      fontFamily: {
        sans: ["Outfit", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
      animation: {
        "glow-pulse": "glow-pulse 3s ease-in-out infinite",
      },
      keyframes: {
        "glow-pulse": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.7" },
        },
      },
    },
  },
  plugins: [],
};
