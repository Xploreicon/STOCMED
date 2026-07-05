/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
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
        // StocMed design system tokens (Claude Design inventory spec)
        brand: {
          DEFAULT: '#0066CC',
          deep: '#042C53',
          tint: '#F0F7FF',
        },
        hairline: '#E6EEF7',
        ink: '#1A1A1A',
        secondary: '#4A4A4A',
        muted: '#888888',
        stock: {
          in: '#639922',
          'in-bg': '#F2F7EA',
          low: '#BA7517',
          'low-bg': '#FBF2E6',
          out: '#E24B4A',
          'out-bg': '#FBEDEC',
        },
      },
      borderRadius: {
        control: '8px',
        card: '12px',
        feature: '16px',
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'Inter', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
