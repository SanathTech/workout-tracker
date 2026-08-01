import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // Registered by hand in main.jsx so an update can't take over mid-session.
      injectRegister: null,
      registerType: 'prompt',
      // public/manifest.webmanifest is the source of truth; don't generate a second one.
      manifest: false,
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        // Any client route must boot from the cached shell when the network is gone.
        navigateFallback: '/index.html',
        // The API is never served from cache: stale sets are worse than an error, and a
        // cached 401 would outlive a successful re-login.
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  // No manualChunks for Recharts: naming it as a manual chunk makes Vite treat it as an
  // entry dependency and emit a <link rel="modulepreload"> for it, so the 525kB downloads
  // on first paint anyway. The lazy import of /progress in App.jsx does the split on its
  // own, and only fetches it when that route is opened.
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
  // `vite preview` serves the real build, service worker included — the only way to
  // exercise offline behaviour locally, since the SW is disabled in dev.
  preview: {
    port: 5174,
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
});
