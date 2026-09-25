/**
 * Dia-flavoured design tokens. Window chrome sits on a warm, grained tint;
 * content lives on a raised card. Light values first, `dark:` variants in use.
 * @type {import('tailwindcss').Config}
 */
module.exports = {
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: "#1B1718",
          muted: "#6E6668",
          faint: "#A39B9D",
          inverse: "#F4EFF0",
          "inverse-muted": "#A8A0A2",
          "inverse-faint": "#6C6264",
        },
        card: {
          DEFAULT: "#FFFFFF",
          dark: "#141112",
        },
        spectrum: {
          blue: "#0358F7",
          steel: "#5092C7",
          lavender: "#E1E1FE",
          yellow: "#FFD400",
          orange: "#FA3D1D",
          magenta: "#FD02F5",
        },
      },
      borderRadius: {
        card: "10px",
        tab: "10px",
        bar: "18px",
      },
      fontSize: {
        tab: ["13px", { lineHeight: "16px" }],
        crumb: ["13px", { lineHeight: "16px" }],
        bar: ["17px", { lineHeight: "22px" }],
      },
    },
  },
};
