/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'ferro-blue': '#004de6', // Deeper, more professional red
        'ferro-green': '#10b981', // Professional forest green
        'accent': '#F8F9FA', // Light grey for backgrounds
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
      },
    },
  },
  plugins: [],
}
