/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: '#0066CC',
        'primary-blue': '#0066CC',
        'light-blue-bg': '#F0F7FF',
        'dark-gray': '#1A1A1A',
        'medium-gray': '#4A4A4A',
      },
    },
  },
  plugins: [],
}
