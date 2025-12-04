/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: '#0066CC',
        'light-blue-bg': '#F0F7FF',
        'dark-gray': '#1A1A1A',
        'medium-gray': '#4A4A4A',
      },
    },
  },
  plugins: [],
}
