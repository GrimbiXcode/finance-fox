/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"IBM Plex Sans"', "system-ui", "-apple-system", '"Segoe UI"', "Roboto", "sans-serif"],
        serif: ['"Newsreader Variable"', '"Iowan Old Style"', '"Palatino Linotype"', "Palatino", "Georgia", "serif"],
        mono: ['"IBM Plex Mono"', "ui-monospace", '"SF Mono"', "Menlo", "Consolas", "monospace"],
      },
      colors: {
        // Papier-Design: Farbe nur mit Bedeutung (docs/design/paper-like)
        positive: "hsl(var(--positive))",
        negative: "hsl(var(--negative))",
        warning: "hsl(var(--warning))",
        stamp: {
          DEFAULT: "hsl(var(--stamp))",
          foreground: "hsl(var(--stamp-foreground))",
        },
        note: {
          DEFAULT: "hsl(var(--note))",
          foreground: "hsl(var(--note-foreground))",
        },
        "paper-deep": "hsl(var(--paper-deep))",
        "rule-strong": "hsl(var(--rule-strong))",
        pencil: {
          1: "hsl(var(--pencil-1))",
          2: "hsl(var(--pencil-2))",
          3: "hsl(var(--pencil-3))",
          4: "hsl(var(--pencil-4))",
          5: "hsl(var(--pencil-5))",
          6: "hsl(var(--pencil-6))",
          7: "hsl(var(--pencil-7))",
          8: "hsl(var(--pencil-8))",
        },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive) / <alpha-value>)",
          foreground: "hsl(var(--destructive-foreground) / <alpha-value>)",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
      },
      // Geschnittenes Papier: Blätter und Dialoge 4 px, Bedienelemente 3 px,
      // Chips 2 px (--radius = 0.25rem in index.css).
      borderRadius: {
        xl: "var(--radius)",
        lg: "var(--radius)",
        md: "calc(var(--radius) - 1px)",
        sm: "calc(var(--radius) - 2px)",
        xs: "calc(var(--radius) - 2px)",
      },
      // Aufliegendes Blatt (sm) und abgehobenes Blatt (md/lg: Popover, Dialog)
      boxShadow: {
        xs: "0 1px 0 rgb(33 29 24 / 0.05)",
        sm: "var(--shadow-sheet)",
        md: "var(--shadow-lift)",
        lg: "var(--shadow-lift)",
        sheet: "var(--shadow-sheet)",
        lift: "var(--shadow-lift)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "caret-blink": {
          "0%,70%,100%": { opacity: "1" },
          "20%,50%": { opacity: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "caret-blink": "caret-blink 1.25s ease-out infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
}