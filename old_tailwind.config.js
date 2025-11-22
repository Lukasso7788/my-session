/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brandBlack: "#2F2F2F",
        borderGray: "#DBD8D8",

        deepWork: "#5286F6",
        pomodoro: "#F65252",
        sprints: "#65D46C",

        bookedGreen: "#32D74B",
      },
      fontFamily: {
        inter: ["Inter", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
