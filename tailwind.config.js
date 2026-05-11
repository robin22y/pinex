/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,jsx}",
  ],
  theme: {
    extend: {
      spacing: {
        safe: 'env(safe-area-inset-bottom)',
      },
      colors: {
        'surface': '#0D1525',
        'base': '#080C14',
        'border-subtle': '#1E293B',
        'text-muted': '#64748B',
        'green-signal': '#22C55E',
        'amber-signal': '#F59E0B',
        'red-signal': '#EF4444',
        'blue-accent': '#38BDF8',
      },
    },
  },
  plugins: [],
}