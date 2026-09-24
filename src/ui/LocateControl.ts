import L from 'leaflet';
import type WaButton from '@awesome.me/webawesome/dist/components/button/button.js';
import { getCurrentLocation, type LocationUpdate } from '../location/LocationTracker';
import { LocationLayer } from './LocationLayer';
import { showToast } from './toast';

export const LOCATE_ZOOM = 16;

// A Leaflet control holding a Web Awesome button that centres the map on the
// user's position and shows it as a dot. Leaflet positions it, so it needs no CSS.
export class LocateControl extends L.Control {
  private button: WaButton | null = null;
  private layer: LocationLayer | null = null;

  constructor(options: L.ControlOptions = { position: 'bottomright' }) {
    super(options);
  }

  onAdd(map: L.Map): HTMLElement {
    const button = document.createElement('wa-button');
    button.setAttribute('pill', '');
    button.setAttribute('size', 'l');
    button.setAttribute('appearance', 'filled-outlined');
    button.innerHTML = '<wa-icon name="locate" label="Show my location"></wa-icon>';
    L.DomEvent.disableClickPropagation(button); // don't let the tap place a map point
    button.addEventListener('click', () => void this.locate(map));
    this.button = button;
    this.layer = new LocationLayer(map);
    return button;
  }

  onRemove(): void {
    this.layer?.destroy();
    this.layer = null;
  }

  // Centre on the current position. Call from a tap, or once permission is known to be granted.
  async locate(map: L.Map): Promise<LocationUpdate | null> {
    if (this.button) this.button.loading = true;
    try {
      const pos = await getCurrentLocation();
      this.layer?.update(pos);
      map.setView([pos.lat, pos.lon], Math.max(map.getZoom(), LOCATE_ZOOM));
      return pos;
    } catch (err) {
      showToast(`Location error: ${(err as Error).message}`);
      return null;
    } finally {
      if (this.button) this.button.loading = false;
    }
  }
}
