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
        "landing-hero": "landing-hero 0.8s ease-out forwards",
        "landing-block": "landing-block 0.6s ease-out forwards",
        "landing-chart-bar": "landing-chart-bar 1s ease-out forwards",
      },
      keyframes: {
        "glow-pulse": { "0%,100%": { opacity: "1" }, "50%": { opacity: "0.7" } },
        "shimmer":    { "0%": { backgroundPosition: "-200% 0" }, "100%": { backgroundPosition: "200% 0" } },
        "fade-in":    { "0%": { opacity: "0", transform: "translateY(8px)" }, "100%": { opacity: "1", transform: "translateY(0)" } },
        "landing-hero": {
          "0%": { opacity: "0", transform: "translateY(24px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "landing-block": {
          "0%": { opacity: "0", transform: "scale(0.96) translateY(20px)" },
          "100%": { opacity: "1", transform: "scale(1) translateY(0)" },
        },
        "landing-chart-bar": {
          "0%": { transform: "scaleY(0)", opacity: "0" },
          "100%": { transform: "scaleY(1)", opacity: "1" },
        },
      },
    },
  },
  plugins: [],
};
