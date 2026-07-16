/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      // Parlo palette — "Playful & Bright". LIGHT-first, VIOLET→PINK→CORAL forward.
      // The page is a soft warm off-white with a lilac tint; surfaces are white with
      // soft violet-tinted shadows. Iris (violet) and glow (fuchsia) are the accents,
      // and the signature gradient (violet → fuchsia → rose) is the star of the show.
      colors: {
        ink: "#faf8ff", // page background (soft warm off-white, lilac tint)
        surface: "#f5f0ff", // raised / tinted panels
        card: "#ffffff", // cards / chat bubbles
        edge: "#ece7fb", // soft lilac borders
        fog: "#241b3d", // primary text (deep plum-slate)
        dim: "#6f6790", // secondary text (muted purple-gray)
        iris: { DEFAULT: "#7c3aed", deep: "#6d28d9" }, // primary accent (violet)
        glow: { DEFAULT: "#d946ef", deep: "#c026d3" }, // secondary accent (fuchsia)
        coral: { DEFAULT: "#fb7185", deep: "#f43f5e" }, // warm end of the gradient
      },
      boxShadow: {
        // Soft, colorful violet-tinted shadows (never harsh gray).
        soft: "0 8px 24px -8px rgba(124, 58, 237, 0.18), 0 2px 8px -4px rgba(217, 70, 239, 0.10)",
        lift: "0 16px 40px -12px rgba(124, 58, 237, 0.28), 0 4px 12px -6px rgba(217, 70, 239, 0.14)",
        glow: "0 8px 24px -6px rgba(217, 70, 239, 0.45)",
      },
      backgroundImage: {
        // The signature gradient — reuse everywhere for continuity.
        signature: "linear-gradient(135deg, #7c3aed 0%, #d946ef 50%, #fb7185 100%)",
        "page-wash": "linear-gradient(180deg, #fbf9ff 0%, #f5f0ff 100%)",
      },
      keyframes: {
        "fade-in-up": {
          "0%": { opacity: "0", transform: "translateY(10px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "pop-in": {
          "0%": { opacity: "0", transform: "scale(0.92)" },
          "60%": { opacity: "1", transform: "scale(1.02)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
      },
      animation: {
        "fade-in-up": "fade-in-up 0.4s ease-out both",
        "pop-in": "pop-in 0.35s ease-out both",
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
