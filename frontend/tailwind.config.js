/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      // Parlo palette — dark-first: charcoal surfaces, mint accent, violet secondary.
      colors: {
        ink: "#0e1116", // page background
        surface: "#151a21", // raised panels
        card: "#1a202a", // cards / chat bubbles
        edge: "#28303c", // borders
        fog: "#e8ecf1", // primary text
        dim: "#98a2b3", // secondary text
        mint: { DEFAULT: "#34d399", deep: "#059669" },
        violet: { DEFAULT: "#a78bfa", deep: "#8b5cf6" },
      },
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "sans-serif",
        ],
      },
    },
  },
  plugins: [],
};
