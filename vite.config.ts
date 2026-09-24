/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// Vite's default build target ('baseline-widely-available': Chrome 111+, iOS/Safari 16.4+)
// already matches current Android and iOS browsers, so no target is configured here.
export default defineConfig({
  base: './',
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      // Icons, favicon and apple-touch-icon are generated from one SVG and injected into index.html
      pwaAssets: { image: 'public/icon.svg', preset: 'minimal-2023', overrideManifestIcons: true, injectThemeColor: false },
      manifest: {
        name: 'Custom Maps',
        short_name: 'Custom Maps',
        description: 'Use any map image as a live GPS map. Local-first, no account required.',
        theme_color: '#0071ec',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: './',
        scope: './',
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,dac}'],
        runtimeCaching: [
          {
            // Keep OSM tiles the user has already viewed for offline use (no prefetching —
            // bulk downloads are against the OSM tile usage policy).
            urlPattern: /^https:\/\/tile\.openstreetmap\.org\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'osm-tiles',
              expiration: { maxEntries: 3000, maxAgeSeconds: 7 * 24 * 60 * 60 },
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
      },
    }),
  ],
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
