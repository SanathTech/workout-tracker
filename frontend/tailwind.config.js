/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      // The five type roles (2026-08-04 refinement): label/tag 11, meta 13 (xs),
      // body 15 (sm), title 16 (base), page 22 (2xl). 10px and 12px are dead sizes —
      // remapping xs/sm/2xl here moved the whole app in one edit.
      fontSize: {
        xs: ['0.8125rem', { lineHeight: '1.25rem' }],   // 13px meta
        sm: ['0.9375rem', { lineHeight: '1.45rem' }],   // 15px body
        '2xl': ['1.375rem', { lineHeight: '1.85rem' }], // 22px page title
      },
    },
  },
  plugins: [],
};
