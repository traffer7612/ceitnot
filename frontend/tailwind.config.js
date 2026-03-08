/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        aura: {
          bg:           "#080810",
          surface:      "#0f0f1a",
          "surface-2":  "#161625",
          border:       "#1e1e32",
          "border-2":   "#2a2a42",
          muted:        "#5a5a78",
          "muted-2":    "#8888a8",
          gold:         "#d4a853",
          "gold-dim":   "#9a7b3a",
          "gold-bright":"#e8c070",
          accent:       "#8b5cf6",
          "accent-dim": "#6d3fd8",
          cyan:         "#06b6d4",
          success:      "#22c55e",
          warning:      "#f59e0b",
          danger:       "#ef4444",
        },
      },
      fontFamily: {
        sans: ["Outfit", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
      backgroundImage: {
        "gradient-gold": "linear-gradient(135deg, #d4a853, #8b5cf6)",
        "gradient-surface": "radial-gradient(ellipse 80% 50% at 50% -20%, rgba(212,168,83,0.10), transparent)",
      },
      animation: {
        "glow-pulse": "glow-pulse 3s ease-in-out infinite",
        "shimmer":    "shimmer 1.5s infinite",
        "fade-in":    "fade-in 0.3s ease-out",
      },
      keyframes: {
        "glow-pulse": { "0%,100%": { opacity: "1" }, "50%": { opacity: "0.7" } },
        "shimmer":    { "0%": { backgroundPosition: "-200% 0" }, "100%": { backgroundPosition: "200% 0" } },
        "fade-in":    { "0%": { opacity: "0", transform: "translateY(8px)" }, "100%": { opacity: "1", transform: "translateY(0)" } },
      },
    },
  },
  plugins: [],
};
