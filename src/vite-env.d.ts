/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

/** Production URL of the app (set at build time on Vercel), or '' to use the current site. */
declare const __APP_URL__: string;
// Base URL of shared .kmz files ('' when link sharing isn't set up), see vite.config.ts
declare const __MAPS_URL__: string;
