import './ui/webawesome';
import 'leaflet/dist/leaflet.css';
import './styles.css';
import L from 'leaflet';
import { followSystemColorScheme } from './ui/colorScheme';
import { registerSW } from 'virtual:pwa-register';
import { inject } from '@vercel/analytics';
import { injectSpeedInsights } from '@vercel/speed-insights';

// Without this, the first load after a deploy runs the previously cached version: the new
// service worker swaps the cache in the background but the open page keeps the old code.
// In autoUpdate mode this reloads once when an updated service worker takes over.
registerSW({ immediate: true });

// Vercel Web Analytics + Speed Insights: cookieless, served from this site's own /_vercel path.
// __APP_URL__ is only set in Vercel builds, so local and CI builds send nothing.
if (__APP_URL__) {
  inject();
  injectSpeedInsights();
}

// Fix Leaflet default marker icons under Vite bundling
// @ts-expect-error - _getIconUrl is an internal implementation detail
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl: new URL('leaflet/dist/images/marker-icon.png', import.meta.url).href,
  iconRetinaUrl: new URL('leaflet/dist/images/marker-icon-2x.png', import.meta.url).href,
  shadowUrl: new URL('leaflet/dist/images/marker-shadow.png', import.meta.url).href,
});

import { MapLibrary } from './ui/MapLibrary';

followSystemColorScheme();

const root = document.getElementById('app')!;
new MapLibrary(root).mount();
