import './ui/webawesome';
import 'leaflet/dist/leaflet.css';
import './styles.css';
import L from 'leaflet';
import { followSystemColorScheme } from './ui/colorScheme';

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
