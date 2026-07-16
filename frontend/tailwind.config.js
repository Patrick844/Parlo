/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      // Parlo palette — dark-first, VIOLET-forward. Iris (violet) is the signature
      // accent; glow (fuchsia) is the secondary pop. Surfaces are violet-tinted charcoal.
      colors: {
        ink: "#0f0d17", // page background
        surface: "#171525", // raised panels
        card: "#1d1a2e", // cards / chat bubbles
        edge: "#312c45", // borders
        fog: "#ece9f5", // primary text
        dim: "#a29db8", // secondary text
        iris: { DEFAULT: "#a78bfa", deep: "#7c3aed" }, // primary accent (violet)
        glow: { DEFAULT: "#e879f9", deep: "#c026d3" }, // secondary accent (fuchsia)
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
