/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// Vite's default build target ('baseline-widely-available': Chrome 111+, iOS/Safari 16.4+)
// already matches current Android and iOS browsers, so no target is configured here.
// Where shared maps are read from (see src/io/publish.ts). MAPS_URL overrides it (tests, or a
// self-hosted server); on Vercel it is the public URL of the Blob store connected to the project,
// whose id is the 4th part of its token. Only the store id is used, never the secret.
const blobStoreId = process.env.BLOB_READ_WRITE_TOKEN?.split('_')[3];
const mapsUrl = process.env.MAPS_URL
  ?? (blobStoreId ? `https://${blobStoreId.toLowerCase()}.public.blob.vercel-storage.com/` : '');

export default defineConfig({
  base: './',
  define: {
    __MAPS_URL__: JSON.stringify(mapsUrl),
    // Link used in share messages: the production site, even when shared from a preview build.
    // Vercel provides the production domain at build time; locally the current site is used.
    __APP_URL__: JSON.stringify(
      process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}/` : '',
    ),
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false, // registered in src/main.ts so updates reload the page
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
        // Activate a new version straight away (with registerSW in main.ts reloading the page);
        // without these the update waits until every tab of the app has been closed.
        skipWaiting: true,
        clientsClaim: true,
        // Short links (/m/<id>) must reach Vercel, which redirects them to /?m=<id>; served from
        // the cache instead, the app would load at /m/ and its relative asset paths would break.
        navigateFallbackDenylist: [/^\/m\//],
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
    include: ['src/**/*.test.ts', 'api/**/*.test.ts'],
    environment: 'node',
  },
});
