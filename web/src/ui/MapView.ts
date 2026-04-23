import L from 'leaflet';
import { GeoToImageConverter } from '../core/GeoToImageConverter';
import type { GroundOverlay } from '../core/GroundOverlay';
import { LocationTracker } from '../location/LocationTracker';
import { LocationLayer } from './LocationLayer';

export class MapView {
  private map: L.Map | null = null;
  private imageUrl: string | null = null;
  private tracker = new LocationTracker();
  private locationLayer: LocationLayer | null = null;

  constructor(
    private overlay: GroundOverlay,
    private onBack: () => void,
  ) {}

  mount(container: HTMLElement): void {
    try {
      this.mountInternal(container);
    } catch (err) {
      container.innerHTML = '';
      const msg = document.createElement('p');
      msg.style.cssText = 'padding:2rem;color:var(--pico-del-color,#c0392b);';
      msg.textContent = `Failed to open map: ${(err as Error).message}`;
      const back = document.createElement('button');
      back.textContent = '← Back';
      back.style.cssText = 'margin:0 2rem;';
      back.addEventListener('click', this.onBack);
      container.appendChild(msg);
      container.appendChild(back);
    }
  }

  private mountInternal(container: HTMLElement): void {
    container.innerHTML = '';

    // Map container — fills viewport
    const mapDiv = document.createElement('div');
    mapDiv.style.cssText = 'position:fixed;inset:0;';
    container.appendChild(mapDiv);

    this.map = L.map(mapDiv, { zoomControl: true, zoomSnap: 0.25, zoomDelta: 0.5 });
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

    if (isAxisAligned) {
      L.imageOverlay(this.imageUrl, bounds, { opacity: 0.75 }).addTo(this.map);
    } else {
      (new RotatedImageLayer(this.imageUrl, conv, w, h) as unknown as L.Layer).addTo(this.map);
    }

    this.map.fitBounds(bounds, { padding: [20, 20] });

    // Floating UI
    this.mountFloatingUI(container);

    // Location layer
    this.locationLayer = new LocationLayer(this.map);
  }

  private mountFloatingUI(container: HTMLElement): void {
    // Back button
    const backBtn = document.createElement('button');
    backBtn.textContent = '← Back';
    backBtn.style.cssText = 'position:fixed;top:1rem;left:1rem;z-index:1000;padding:.5rem 1rem;font-size:.875rem;';
    backBtn.addEventListener('click', () => this.destroy().then(this.onBack).catch(console.error));
    container.appendChild(backBtn);

    // Locate me button
    const locateBtn = document.createElement('button');
    locateBtn.textContent = '⊙ Locate me';
    locateBtn.style.cssText = 'position:fixed;bottom:max(2rem,calc(env(safe-area-inset-bottom) + 0.5rem));right:1rem;z-index:1000;padding:.75rem 1rem;font-size:1rem;';

    let hasFirstFix = false;

    locateBtn.addEventListener('click', () => {
      if (this.tracker.isActive()) {
        // Already tracking — re-center on latest known position
        const pos = this.locationLayer?.lastLatLon;
        if (pos && this.map) this.map.flyTo(pos, Math.max(this.map.getZoom(), 15));
        return;
      }
      locateBtn.disabled = true;
      locateBtn.textContent = '⊙ Searching…';
      this.tracker.start(
        u => {
          this.locationLayer!.update(u);
          if (!hasFirstFix) {
            hasFirstFix = true;
            this.map?.flyTo([u.lat, u.lon], 15);
            locateBtn.disabled = false;
            locateBtn.textContent = '⊙ Re-center';
          }
        },
        err => {
          locateBtn.disabled = false;
          locateBtn.textContent = '⊙ Locate me';
          showToast(`Location error: ${err.message}`, container);
        },
      );
    });
    container.appendChild(locateBtn);
  }

  async destroy(): Promise<void> {
    this.tracker.stop();
    this.locationLayer?.destroy();
    this.map?.remove();
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
  ) { super(); }

  onAdd(map: L.Map): this {
    this.leafletMap = map;
    const pane = map.getPane('overlayPane')!;
    this.img = document.createElement('img');
    this.img.src = this.url;
    this.img.style.cssText = `position:absolute;transform-origin:0 0;opacity:0.75;width:${this.w}px;height:${this.h}px;`;
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

    // Map image corners to container pixels
    const p00 = toContainerPt(map, this.conv, 0,   0  );
    const p10 = toContainerPt(map, this.conv, w,   0  );
    const p01 = toContainerPt(map, this.conv, 0,   h  );

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

function toContainerPt(map: L.Map, conv: GeoToImageConverter, x: number, y: number): { x: number; y: number } {
  const [lat, lon] = conv.imageToLatLon(x, y);
  return map.latLngToLayerPoint([lat, lon]);
}

function showToast(message: string, container: HTMLElement): void {
  const t = document.createElement('div');
  t.textContent = message;
  t.style.cssText = 'position:fixed;bottom:5rem;left:50%;transform:translateX(-50%);background:#333;color:#fff;padding:.5rem 1rem;border-radius:.5rem;font-size:.85rem;z-index:2000;max-width:90vw;text-align:center;';
  container.appendChild(t);
  setTimeout(() => t.remove(), 4000);
}
