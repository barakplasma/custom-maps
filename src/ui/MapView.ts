import L from 'leaflet';
import { GeoToImageConverter } from '../core/GeoToImageConverter';
import type { GroundOverlay } from '../core/GroundOverlay';
import { getOverlayOpacity, setOverlayOpacity } from '../storage/Prefs';
import { createLocateControl, keepScreenOnWhileLocating } from './locate';

export class MapView {
  private map: L.Map | null = null;
  private imageUrl: string | null = null;

  constructor(
    private overlay: GroundOverlay,
    private onBack: () => void,
  ) {}

  mount(container: HTMLElement): void {
    try {
      this.mountInternal(container);
    } catch (err) {
      container.innerHTML = `
        <div class="app-content wa-stack wa-gap-m">
          <wa-callout variant="danger">
            <wa-icon slot="icon" name="circle-alert"></wa-icon>
            <span></span>
          </wa-callout>
          <wa-button appearance="outlined"><wa-icon slot="start" name="arrow-left"></wa-icon> Back</wa-button>
        </div>`;
      container.querySelector('wa-callout span')!.textContent = `Failed to open map: ${(err as Error).message}`;
      container.querySelector('wa-button')!.addEventListener('click', this.onBack);
    }
  }

  private mountInternal(container: HTMLElement): void {
    container.innerHTML = '';

    // Map container — fills viewport
    const mapDiv = document.createElement('div');
    mapDiv.className = 'map-fullscreen';
    container.appendChild(mapDiv);

    this.map = L.map(mapDiv, { zoomControl: false, zoomSnap: 0.25, zoomDelta: 0.5 });
    // Top-left is taken by the Back button
    L.control.zoom({ position: 'topright' }).addTo(this.map);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(this.map);

    // Build converter from tiepoints
    const conv = new GeoToImageConverter();
    conv.setFromTiepoints(this.overlay.tiepoints);

    // Compute bounding box from image corners
    const w = this.overlay.imageWidth, h = this.overlay.imageHeight;
    const corners = [[0,0],[w,0],[w,h],[0,h]].map(([x,y]) => conv.imageToLatLon(x!, y!));
    const lats = corners.map(c => c[0]);
    const lons = corners.map(c => c[1]);
    const bounds = L.latLngBounds([Math.min(...lats), Math.min(...lons)], [Math.max(...lats), Math.max(...lons)]);

    this.imageUrl = URL.createObjectURL(this.overlay.imageBlob);

    // Choose simple overlay vs rotated custom layer
    const rotation = this.overlay.latLonBox?.rotation ?? 0;
    const isAxisAligned = Math.abs(rotation) < 0.5 && isApproximatelyAxisAligned(corners, w, h);
    const opacity = getOverlayOpacity();
    const imageLayer = isAxisAligned
      ? L.imageOverlay(this.imageUrl, bounds, { opacity })
      : new RotatedImageLayer(this.imageUrl, conv, w, h, opacity);
    imageLayer.addTo(this.map);

    this.map.fitBounds(bounds, { padding: [20, 20] });

    // Navigation: follow the user with a compass heading; screen stays on meanwhile
    createLocateControl({ setView: 'untilPan', keepCurrentZoomLevel: true, initialZoomLevel: 16 }).addTo(this.map);
    keepScreenOnWhileLocating(this.map);

    this.mountFloatingUI(container, imageLayer);
  }

  private mountFloatingUI(container: HTMLElement, imageLayer: { setOpacity(o: number): unknown }): void {
    container.insertAdjacentHTML('beforeend', `
      <div class="float-top-start wa-stack wa-gap-s">
        <wa-button id="cm-map-back" appearance="filled-outlined" pill size="l">
          <wa-icon name="arrow-left" label="Back to maps"></wa-icon>
        </wa-button>
        <wa-button id="cm-opacity" appearance="filled-outlined" pill size="l">
          <wa-icon name="blend" label="Map image transparency"></wa-icon>
        </wa-button>
      </div>
      <wa-popover for="cm-opacity" placement="right-start">
        <wa-slider id="cm-opacity-slider" label="Map image opacity" min="0.1" max="1" step="0.05"
          value="${getOverlayOpacity()}"></wa-slider>
      </wa-popover>`);

    container.querySelector('#cm-map-back')!.addEventListener('click', () => {
      this.destroy();
      this.onBack();
    });

    const slider = container.querySelector('wa-slider')!;
    slider.valueFormatter = (v: number) => `${Math.round(v * 100)}%`;
    slider.addEventListener('input', () => imageLayer.setOpacity(slider.value));
    slider.addEventListener('change', () => setOverlayOpacity(slider.value));
  }

  destroy(): void {
    this.map?.remove(); // also stops location watching and releases the wake lock
    this.map = null;
    if (this.imageUrl) { URL.revokeObjectURL(this.imageUrl); this.imageUrl = null; }
  }
}

// Returns true when the map image corners are approximately aligned with the N/S/E/W axes.
function isApproximatelyAxisAligned(corners: [number,number][], _w: number, _h: number): boolean {
  // Check that top-left and top-right have similar latitudes, and top-left and bottom-left have similar lons
  const [tl, tr, , bl] = corners;
  const latSpan = Math.abs(tl[0] - tr[0]);
  const lonSpan = Math.abs(tl[1] - bl[1]);
  const totalLatSpan = Math.abs(tl[0] - corners[2][0]);
  const totalLonSpan = Math.abs(tl[1] - corners[1][1]);
  return latSpan < totalLatSpan * 0.02 && lonSpan < totalLonSpan * 0.02;
}

// Custom Leaflet layer for rotated/skewed image overlay using CSS transform.
class RotatedImageLayer extends L.Layer {
  private img: HTMLImageElement | null = null;
  private leafletMap: L.Map | null = null;

  constructor(
    private url: string,
    private conv: GeoToImageConverter,
    private w: number,
    private h: number,
    private opacity: number,
  ) { super(); }

  setOpacity(opacity: number): this {
    this.opacity = opacity;
    if (this.img) this.img.style.opacity = String(opacity);
    return this;
  }

  onAdd(map: L.Map): this {
    this.leafletMap = map;
    const pane = map.getPane('overlayPane')!;
    this.img = document.createElement('img');
    this.img.className = 'leaflet-image-layer'; // Leaflet's CSS exempts this class from img { max-width: 100% }
    this.img.src = this.url;
    this.img.style.cssText = `position:absolute;transform-origin:0 0;opacity:${this.opacity};width:${this.w}px;height:${this.h}px;`;
    this.img.draggable = false;
    pane.appendChild(this.img);
    map.on('viewreset move zoom', this.reposition, this);
    this.reposition();
    return this;
  }

  onRemove(map: L.Map): this {
    this.img?.remove();
    this.img = null;
    this.leafletMap = null;
    map.off('viewreset move zoom', this.reposition, this);
    return this;
  }

  private reposition(): void {
    if (!this.img || !this.leafletMap) return;
    const map = this.leafletMap;
    const w = this.w, h = this.h;

    // Map image corners to overlay-pane pixels
    const p00 = toLayerPt(map, this.conv, 0,   0  );
    const p10 = toLayerPt(map, this.conv, w,   0  );
    const p01 = toLayerPt(map, this.conv, 0,   h  );

    // CSS matrix(a,b,c,d,e,f) transform
    const a = (p10.x - p00.x) / w;
    const b = (p10.y - p00.y) / w;
    const c = (p01.x - p00.x) / h;
    const d = (p01.y - p00.y) / h;
    const e = p00.x;
    const f = p00.y;

    this.img.style.transform = `matrix(${a},${b},${c},${d},${e},${f})`;
  }
}

// Pane-relative position. The overlay pane is itself translated while the map pans, so
// container points would apply the pan offset twice and the image would slide off the map.
function toLayerPt(map: L.Map, conv: GeoToImageConverter, x: number, y: number): { x: number; y: number } {
  const [lat, lon] = conv.imageToLatLon(x, y);
  return map.latLngToLayerPoint([lat, lon]);
}
