// Web Awesome setup: styles, the components the app uses, and a local icon library.
// Components are cherry-picked so the bundle only contains what we render.
import '@awesome.me/webawesome/dist/styles/webawesome.css';
import '@awesome.me/webawesome/dist/components/button/button.js';
import '@awesome.me/webawesome/dist/components/callout/callout.js';
import '@awesome.me/webawesome/dist/components/card/card.js';
import '@awesome.me/webawesome/dist/components/copy-button/copy-button.js';
import '@awesome.me/webawesome/dist/components/dialog/dialog.js';
import '@awesome.me/webawesome/dist/components/divider/divider.js';
import '@awesome.me/webawesome/dist/components/dropdown/dropdown.js';
import '@awesome.me/webawesome/dist/components/dropdown-item/dropdown-item.js';
import '@awesome.me/webawesome/dist/components/icon/icon.js';
import '@awesome.me/webawesome/dist/components/input/input.js';
import '@awesome.me/webawesome/dist/components/popover/popover.js';
import '@awesome.me/webawesome/dist/components/qr-code/qr-code.js';
import '@awesome.me/webawesome/dist/components/slider/slider.js';
import '@awesome.me/webawesome/dist/components/spinner/spinner.js';
import '@awesome.me/webawesome/dist/components/toast/toast.js';
import { registerIconLibrary } from '@awesome.me/webawesome/dist/webawesome.js';

// The default icon library loads Font Awesome from a CDN. This app makes no external
// requests besides OSM tiles, so icons are bundled Lucide SVGs (ISC) instead.
// To use a new icon, add its Lucide name to this list.
const icons = import.meta.glob(
  '/node_modules/lucide-static/icons/{arrow-left,blend,check,chevron-right,circle-alert,ellipsis-vertical,folder-open,image-plus,link,locate,locate-fixed,map,map-pin,pencil,plus,share-2,trash-2}.svg',
  { query: '?url', import: 'default', eager: true },
) as Record<string, string>;

const iconUrls = new Map(
  Object.entries(icons).map(([path, url]) => [path.split('/').pop()!.replace(/\.svg$/, ''), url]),
);

registerIconLibrary('default', {
  resolver: (name) => {
    const url = iconUrls.get(name);
    if (!url) console.warn(`Icon "${name}" is not bundled; add it in src/ui/webawesome.ts`);
    return url ?? '';
  },
});
