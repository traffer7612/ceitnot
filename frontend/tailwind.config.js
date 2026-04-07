/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        ceitnot: {
          bg:           "rgb(var(--ceitnot-bg) / <alpha-value>)",
          surface:      "rgb(var(--ceitnot-surface) / <alpha-value>)",
          "surface-2":  "rgb(var(--ceitnot-surface-2) / <alpha-value>)",
          border:       "rgb(var(--ceitnot-border) / <alpha-value>)",
          "border-2":   "rgb(var(--ceitnot-border-2) / <alpha-value>)",
          ink:          "rgb(var(--ceitnot-ink) / <alpha-value>)",
          muted:        "rgb(var(--ceitnot-muted) / <alpha-value>)",
          "muted-2":    "rgb(var(--ceitnot-muted-2) / <alpha-value>)",
          gold:         "rgb(var(--ceitnot-gold) / <alpha-value>)",
          "gold-dim":   "rgb(var(--ceitnot-gold-dim) / <alpha-value>)",
          "gold-bright":"rgb(var(--ceitnot-gold-bright) / <alpha-value>)",
          accent:       "rgb(var(--ceitnot-accent) / <alpha-value>)",
          "accent-dim": "rgb(var(--ceitnot-accent-dim) / <alpha-value>)",
          mint:         "rgb(var(--ceitnot-mint) / <alpha-value>)",
          "mint-dim":   "rgb(var(--ceitnot-mint-dim) / <alpha-value>)",
          "mint-bright":"rgb(var(--ceitnot-mint-bright) / <alpha-value>)",
          cyan:         "rgb(var(--ceitnot-cyan) / <alpha-value>)",
          success:      "rgb(var(--ceitnot-success) / <alpha-value>)",
          warning:      "rgb(var(--ceitnot-warning) / <alpha-value>)",
          danger:       "rgb(var(--ceitnot-danger) / <alpha-value>)",
          /** Text on primary (mint/teal) CTA buttons */
          "on-primary": "rgb(var(--ceitnot-on-primary) / <alpha-value>)",
        },
      },
      fontFamily: {
        sans: ["Outfit", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
      backgroundImage: {
        "gradient-gold": "linear-gradient(135deg, rgb(var(--ceitnot-gold)), rgb(var(--ceitnot-accent-dim)))",
        "gradient-surface":
          "radial-gradient(ellipse 90% 60% at 50% -25%, rgb(var(--ceitnot-accent-dim) / 0.18), transparent)",
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
