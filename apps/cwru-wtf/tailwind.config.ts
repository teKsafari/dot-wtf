import type { Config } from "tailwindcss"

const config: Config = {
  darkMode: ["class"],
  future: {
    // Touch devices fire :hover on tap and leave it stuck until the next tap
    // elsewhere. This compiles every `hover:` utility under
    // `@media (hover: hover)` so those states only exist for real pointers.
    hoverOnlyWhenSupported: true,
  },
  content: [
    "./pages/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./app/**/*.{ts,tsx}",
    "./src/**/*.{ts,tsx}",
    "*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      fontFamily: {
        // SF Pro Rounded, by every route available to a stylesheet: the named
        // family first, for machines that have Apple's download installed;
        // then `ui-rounded`, which resolves to it on every Apple platform
        // whether installed or not. Nunito only catches what is left —
        // Windows, Android, Linux — where the file cannot be served, since
        // Apple's font licence does not permit embedding it on the web.
        //
        // `brand` and `primary` stay as aliases so existing markup keeps
        // working; there is one family now.
        sans: [
          "'SF Pro Rounded'",
          "ui-rounded",
          "var(--font-rounded)",
          "ui-sans-serif",
          "system-ui",
          "sans-serif",
        ],
        brand: [
          "'SF Pro Rounded'",
          "ui-rounded",
          "var(--font-rounded)",
          "ui-sans-serif",
          "system-ui",
          "sans-serif",
        ],
        primary: [
          "'SF Pro Rounded'",
          "ui-rounded",
          "var(--font-rounded)",
          "ui-sans-serif",
          "system-ui",
          "sans-serif",
        ],
        nunito: ["var(--font-rounded)", "ui-sans-serif", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "Consolas", "monospace"],
      },
      fontSize: {
        display: [
          "clamp(2.75rem, 7vw, 4.5rem)",
          { lineHeight: "1.05", letterSpacing: "-0.035em", fontWeight: "600" },
        ],
        "page-title": [
          "clamp(2rem, 4vw, 3rem)",
          { lineHeight: "1.1", letterSpacing: "-0.025em", fontWeight: "600" },
        ],
        "section-title": [
          "1.25rem",
          { lineHeight: "1.3", letterSpacing: "-0.015em", fontWeight: "600" },
        ],
        body: ["1rem", { lineHeight: "1.6", fontWeight: "400" }],
        "body-sm": ["0.875rem", { lineHeight: "1.5", fontWeight: "400" }],
        caption: [
          "0.8125rem",
          { lineHeight: "1.4", letterSpacing: "0.01em", fontWeight: "500" },
        ],
      },
      maxWidth: {
        content: "680px",
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          hover: "hsl(var(--primary-hover))",
          active: "hsl(var(--primary-active))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
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
        edge: "hsl(var(--edge))",
        link: "hsl(var(--link))",
        success: "hsl(var(--success))",
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
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
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "fade-in-up": {
          from: { opacity: "0", transform: "translateY(12px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "fade-in": "fade-in 0.6s ease-out both",
        "fade-in-up": "fade-in-up 0.6s ease-out both",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
}

export default config
