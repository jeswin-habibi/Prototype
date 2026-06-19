/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
      },
      colors: {
        // Accent — emerald green
        brand: {
          50: '#ecfdf5',
          100: '#d1fae5',
          200: '#a7f3d0',
          300: '#6ee7b7',
          400: '#34d399',
          500: '#10b981',
          600: '#059669',
          700: '#047857',
          800: '#065f46',
          900: '#064e3b',
          DEFAULT: '#059669',
          dark: '#047857',
          light: '#10b981',
        },
        // Chrome — dark navy (header, sidebar, bottom nav, totals bar; also dark-mode surfaces)
        ink: {
          700: '#243044', // borders / dividers
          800: '#121a28', // elevated surfaces (cards)
          900: '#0d141f', // chrome (header / nav)
          950: '#080d15', // page background
        },
      },
      boxShadow: {
        soft: '0 1px 2px rgba(15,23,42,0.04), 0 1px 3px rgba(15,23,42,0.06)',
        card: '0 1px 3px rgba(15,23,42,0.05), 0 6px 16px -8px rgba(15,23,42,0.10)',
        lift: '0 4px 12px -2px rgba(15,23,42,0.10), 0 10px 28px -8px rgba(15,23,42,0.14)',
      },
      borderRadius: {
        xl: '0.875rem',
        '2xl': '1.125rem',
      },
    },
  },
  plugins: [],
}
