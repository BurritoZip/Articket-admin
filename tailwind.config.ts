import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-pretendard)", "system-ui", "sans-serif"],
      },
      fontSize: {
        display: ["2.5rem", { lineHeight: "1.5", fontWeight: "700" }],
        h1: ["2rem", { lineHeight: "1.5", fontWeight: "700" }],
        h2: ["1.5rem", { lineHeight: "1.5", fontWeight: "700" }],
        h3: ["1.1875rem", { lineHeight: "1.5", fontWeight: "700" }],
        body: ["1.0625rem", { lineHeight: "1.5", fontWeight: "400" }],
        "body-sm": ["0.9375rem", { lineHeight: "1.5", fontWeight: "400" }],
        caption: ["0.8125rem", { lineHeight: "1.5", fontWeight: "400" }],
      },
      borderRadius: {
        xs: "2px",
        sm: "4px",
        md: "6px",
        lg: "10px",
        xl: "12px",
      },
      boxShadow: {
        elevation1: "var(--shadow-1)",
        elevation2: "var(--shadow-2)",
        elevation3: "var(--shadow-3)",
        elevation4: "var(--shadow-4)",
      },
      colors: {
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        surface: "hsl(var(--surface))",
        "surface-muted": "hsl(var(--surface-muted))",
        border: "hsl(var(--border))",
        "text-primary": "hsl(var(--text-primary))",
        "text-secondary": "hsl(var(--text-secondary))",
        "text-tertiary": "hsl(var(--text-tertiary))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
          hover: "hsl(var(--primary-hover))",
          weak: "hsl(var(--primary-weak))",
        },
        danger: {
          DEFAULT: "hsl(var(--danger))",
          foreground: "hsl(var(--danger-foreground))",
          weak: "hsl(var(--danger-weak))",
        },
        success: {
          DEFAULT: "hsl(var(--success))",
          foreground: "hsl(var(--success-foreground))",
          weak: "hsl(var(--success-weak))",
        },
        warning: {
          DEFAULT: "hsl(var(--warning))",
          foreground: "hsl(var(--warning-foreground))",
          weak: "hsl(var(--warning-weak))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        ring: "hsl(var(--ring))",
      },
      ringOffsetColor: {
        background: "hsl(var(--background))",
      },
      maxWidth: {
        content: "1200px",
      },
      spacing: {
        gutter: "var(--gutter)",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
